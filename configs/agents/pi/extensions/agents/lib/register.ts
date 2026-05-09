import type {
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { formatAgentsContext, formatLoadedNotification } from "./format";
import { type AgentsRuntime, createAgentsRuntime } from "./runtime";
import { extractAgentsPathTargets } from "./targets";
import type { AgentsContextFile, AgentsSession } from "./types";

const MESSAGE_TYPE = "agents";

export function registerAgentsExtension(pi: ExtensionAPI): void {
  registerAgentsHandlers(pi, createAgentsRuntime());
}

export function registerAgentsHandlers(pi: ExtensionAPI, runtime: AgentsRuntime): void {
  let loadedCwd: string | undefined;
  let session: AgentsSession | undefined;
  const nativeContextKeys = new Set<string>();
  const activeContextKeys = new Set<string>();
  const deliveredContextKeys = new Set<string>();
  const activeContextFiles = new Map<string, AgentsContextFile>();
  const activeContextOrder: string[] = [];

  async function ensureSession(cwd: string): Promise<AgentsSession> {
    if (loadedCwd === cwd && session) return session;

    const nextSession = await runtime.createSession(cwd);
    loadedCwd = cwd;
    session = nextSession;
    nativeContextKeys.clear();
    activeContextKeys.clear();
    deliveredContextKeys.clear();
    activeContextFiles.clear();
    activeContextOrder.length = 0;

    for (const file of nextSession.nativeFiles) {
      nativeContextKeys.add(file.key);
    }

    return nextSession;
  }

  function recordNewContextFiles(files: AgentsContextFile[]): AgentsContextFile[] {
    const newlyActive: AgentsContextFile[] = [];
    for (const file of files) {
      if (nativeContextKeys.has(file.key) || activeContextKeys.has(file.key)) continue;
      activeContextKeys.add(file.key);
      activeContextFiles.set(file.key, file);
      activeContextOrder.push(file.key);
      newlyActive.push(file);
    }
    return newlyActive;
  }

  function collectUndeliveredContextFiles(): AgentsContextFile[] {
    const files: AgentsContextFile[] = [];
    for (const key of activeContextOrder) {
      if (deliveredContextKeys.has(key)) continue;
      const file = activeContextFiles.get(key);
      if (file) files.push(file);
    }
    return files;
  }

  function markDelivered(files: AgentsContextFile[]): void {
    for (const file of files) {
      deliveredContextKeys.add(file.key);
    }
  }

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    const currentSession = await ensureSession(ctx.cwd);
    notifyDiagnostics(ctx, currentSession.diagnostics);
  });

  pi.on("session_compact", async () => {
    deliveredContextKeys.clear();
  });

  pi.on(
    "before_agent_start",
    async (_event, ctx: ExtensionContext): Promise<BeforeAgentStartEventResult | undefined> => {
      await ensureSession(ctx.cwd);
      const files = collectUndeliveredContextFiles();
      if (files.length === 0) return undefined;

      markDelivered(files);
      return { message: agentsContextMessage(files) };
    },
  );

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const currentSession = await ensureSession(ctx.cwd);
    const loadedFiles: AgentsContextFile[] = [];

    for (const target of extractAgentsPathTargets(event.toolName, event.input)) {
      const discovery = await runtime.discoverForTarget(currentSession, ctx.cwd, target);
      notifyDiagnostics(ctx, discovery.diagnostics);
      loadedFiles.push(...recordNewContextFiles(discovery.files));
    }

    if (loadedFiles.length === 0) return;
    markDelivered(loadedFiles);
    notifyLoaded(ctx, loadedFiles);
    pi.sendMessage(agentsContextMessage(loadedFiles), { deliverAs: "steer" });
  });
}

function agentsContextMessage(files: AgentsContextFile[]) {
  return {
    customType: MESSAGE_TYPE,
    content: formatAgentsContext(files),
    display: false,
    details: {
      files: files.map((file) => file.relativePath),
    },
  };
}

function notifyDiagnostics(ctx: ExtensionContext, diagnostics: string[]): void {
  if (!ctx.hasUI) return;
  for (const diagnostic of diagnostics) {
    ctx.ui?.notify?.(diagnostic, "warning");
  }
}

function notifyLoaded(ctx: ExtensionContext, files: AgentsContextFile[]): void {
  if (!ctx.hasUI || files.length === 0) return;
  ctx.ui?.notify?.(formatLoadedNotification(files), "info");
}
