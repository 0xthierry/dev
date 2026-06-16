import { expect, mock, test } from "bun:test";

// watchInbox gates on existsSync(root); force it true so the monitor loop runs
// immediately without a real room directory.
mock.module("node:fs", () => ({
  existsSync: () => true,
  appendFileSync: () => {},
}));

const { registerAmqNotifyExtension } = await import("./register");

type Handler = (event: unknown, ctx: unknown) => unknown;
type Entry = { type: string; customType?: string; data?: unknown };

// A session store whose custom entries persist across extension instances — this is
// how pi carries state across a /reload (rebind) or a stop+resume (new process).
function makeSession() {
  const entries: Entry[] = [];
  return { entries, sessionManager: { getEntries: () => entries } };
}

// One extension instance bound to a (possibly shared) session, modelling pi's
// per-session rebinding: each reload/resume re-runs the factory with a fresh `pi`.
function makeInstance(session: ReturnType<typeof makeSession>) {
  const handlers: Record<string, Handler> = {};
  const sent: string[] = [];
  let parked = false;
  const pi = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
    },
    appendEntry(customType: string, data: unknown) {
      session.entries.push({ type: "custom", customType, data });
    },
    async exec() {
      if (parked) return new Promise(() => {});
      await new Promise((r) => setTimeout(r, 1));
      return { stdout: "[AMQ] 1 message(s) for pi:\n\n- From: tester", code: 0 };
    },
    sendUserMessage(text: string) {
      sent.push(text);
    },
  };
  const ctx = { cwd: "/tmp/amq-notify-test", isIdle: () => true, sessionManager: session.sessionManager };
  return {
    sent,
    // biome-ignore lint/suspicious/noExplicitAny: minimal ExtensionAPI mock
    register: () => registerAmqNotifyExtension(pi as any),
    start: (reason: string) => handlers.session_start?.({ type: "session_start", reason }, ctx),
    shutdown: () => handlers.session_shutdown?.({ type: "session_shutdown", reason: "reload" }, ctx),
    park: () => {
      parked = true;
    },
  };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bindingEntries(session: ReturnType<typeof makeSession>) {
  return session.entries.filter((e) => e.customType === "amq-notify-binding");
}

test("a rebound instance (reload/resume) reuses the persisted room and keeps delivering", async () => {
  const prev = {
    root: process.env.AM_ROOT,
    me: process.env.AM_ME,
    role: process.env.AMQ_NOTIFY_ROLE,
  };
  delete process.env.AM_ROOT;
  delete process.env.AM_ME;
  delete process.env.AMQ_NOTIFY_ROLE;

  try {
    const session = makeSession();

    // First start: mints a room, persists it, and delivers.
    const a = makeInstance(session);
    a.register();
    a.start("startup");
    await tick(25);
    const rootA = process.env.AM_ROOT;
    expect(rootA).toBeTruthy();
    expect(a.sent.length).toBeGreaterThan(0);
    expect(bindingEntries(session).length).toBe(1);

    // Reload/resume: tear down A, re-run the factory as a fresh instance B against
    // the SAME persisted session.
    a.shutdown();
    a.park();

    const b = makeInstance(session);
    b.register();
    b.start("reload");
    await tick(25);

    expect(process.env.AM_ROOT).toBe(rootA); // reconnected to the same room
    expect(b.sent.length).toBeGreaterThan(0); // the rebound instance keeps delivering
    expect(bindingEntries(session).length).toBe(1); // did not mint a second room

    b.park();
  } finally {
    if (prev.root !== undefined) process.env.AM_ROOT = prev.root;
    else delete process.env.AM_ROOT;
    if (prev.me !== undefined) process.env.AM_ME = prev.me;
    else delete process.env.AM_ME;
    if (prev.role !== undefined) process.env.AMQ_NOTIFY_ROLE = prev.role;
    else delete process.env.AMQ_NOTIFY_ROLE;
  }
});

test("a coop-exec worker (inherited AM_ROOT) stays out of the way", async () => {
  const prev = { root: process.env.AM_ROOT, role: process.env.AMQ_NOTIFY_ROLE };
  process.env.AM_ROOT = "/tmp/coop-session"; // as if set by `amq coop exec`
  delete process.env.AMQ_NOTIFY_ROLE;

  try {
    const session = makeSession();
    const w = makeInstance(session);
    w.register();
    w.start("startup");
    await tick(10);
    expect(w.sent.length).toBe(0); // no push loop
    expect(bindingEntries(session).length).toBe(0); // did not mint a room
    expect(process.env.AM_ROOT).toBe("/tmp/coop-session"); // left untouched
    w.park();
  } finally {
    if (prev.root !== undefined) process.env.AM_ROOT = prev.root;
    else delete process.env.AM_ROOT;
    if (prev.role !== undefined) process.env.AMQ_NOTIFY_ROLE = prev.role;
    else delete process.env.AMQ_NOTIFY_ROLE;
  }
});
