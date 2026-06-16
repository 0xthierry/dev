import { expect, mock, test } from "bun:test";

// watchInbox gates on existsSync(root); force it true so the monitor loop runs
// immediately without a real session directory.
mock.module("node:fs", () => ({
  existsSync: () => true,
  appendFileSync: () => {},
}));

const { registerAmqNotifyExtension } = await import("./register");

type Handler = (event: unknown, ctx: unknown) => unknown;

function makePi() {
  const handlers: Record<string, Handler> = {};
  const sent: string[] = [];
  let parked = false;
  const pi = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
    },
    async exec() {
      // Once parked, hang forever (no timer/handle) so the dangling loop lets the
      // test process exit instead of busy-spinning.
      if (parked) return new Promise(() => {});
      await new Promise((r) => setTimeout(r, 1));
      return { stdout: "[AMQ] 1 message(s) for pi:\n\n- From: tester", code: 0 };
    },
    sendUserMessage(text: string) {
      sent.push(text);
    },
  };
  return {
    pi,
    fire: (event: string) => handlers[event]?.({}, {}),
    sent,
    park: () => {
      parked = true;
    },
  };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("push loop keeps delivering across a session_shutdown/session_start (reload)", async () => {
  const prevRoot = process.env.AM_ROOT;
  const prevMe = process.env.AM_ME;
  delete process.env.AM_ROOT; // unset -> resolveBinding mints a derived (pi-as-main) binding

  const h = makePi();
  // biome-ignore lint/suspicious/noExplicitAny: minimal ExtensionAPI mock for the test
  registerAmqNotifyExtension(h.pi as any);
  h.fire("session_start");

  await tick(30);
  const beforeReload = h.sent.length;
  expect(beforeReload).toBeGreaterThan(0); // delivering before the reload

  // The reload: this is the event pair that the old code used to kill the loop on.
  h.fire("session_shutdown");
  h.fire("session_start");

  // Sample twice: a loop that survives keeps growing; a loop killed by the reload
  // plateaus (one in-flight push lands, then nothing). The second sample is the
  // real discriminator.
  await tick(40);
  const afterReload1 = h.sent.length;
  await tick(40);
  const afterReload2 = h.sent.length;
  expect(afterReload1).toBeGreaterThan(beforeReload);
  expect(afterReload2).toBeGreaterThan(afterReload1); // still actively delivering -> loop alive

  h.park();
  if (prevRoot !== undefined) process.env.AM_ROOT = prevRoot;
  if (prevMe !== undefined) process.env.AM_ME = prevMe;
});
