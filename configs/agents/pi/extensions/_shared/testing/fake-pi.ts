import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
};

type FakePiOptions = {
  cwd?: string;
  ctx?: Record<string, unknown>;
  exec?: (command: string, args?: string[], options?: Record<string, unknown>) => Promise<ExecResult>;
};

export type FakeRegisteredCommand = {
  description?: string;
  argumentHint?: string;
  getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | Promise<AutocompleteItem[] | null> | null;
  handler: (args: string, ctx: unknown) => unknown | Promise<unknown>;
  [key: string]: unknown;
};

export type FakeRegisteredTool = {
  name: string;
  label?: string;
  description?: string;
  execute?: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => unknown | Promise<unknown>;
  [key: string]: unknown;
};

export type FakePi = {
  pi: ExtensionAPI;
  commands: Map<string, FakeRegisteredCommand>;
  tools: Map<string, FakeRegisteredTool>;
  handlers: Map<string, Handler[]>;
  activeTools: Set<string>;
  appendedEntries: Array<{ customType: string; data?: unknown }>;
  sentMessages: Array<{ message: unknown; options?: unknown }>;
  sentUserMessages: Array<{ content: unknown; options?: unknown }>;
  uiNotifications: Array<{ message: string; type?: "info" | "warning" | "error" }>;
  autocompleteProviderFactories: Array<(current: AutocompleteProvider) => AutocompleteProvider>;
  emit: (eventName: string, event?: unknown, ctx?: Record<string, unknown>) => Promise<unknown[]>;
  runCommand: (name: string, args?: string, ctx?: Record<string, unknown>) => Promise<unknown>;
  runTool: (name: string, params?: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;
  createContext: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};

export function createFakePi(options: FakePiOptions = {}): FakePi {
  const commands = new Map<string, FakeRegisteredCommand>();
  const tools = new Map<string, FakeRegisteredTool>();
  const handlers = new Map<string, Handler[]>();
  const activeTools = new Set<string>();
  const appendedEntries: FakePi["appendedEntries"] = [];
  const sentMessages: FakePi["sentMessages"] = [];
  const sentUserMessages: FakePi["sentUserMessages"] = [];
  const uiNotifications: FakePi["uiNotifications"] = [];
  const autocompleteProviderFactories: FakePi["autocompleteProviderFactories"] = [];
  const eventBus = new EventEmitter();

  const createContext = (overrides: Record<string, unknown> = {}) => ({
    cwd: options.cwd ?? process.cwd(),
    hasUI: false,
    signal: undefined,
    ui: createFakeUi(autocompleteProviderFactories, uiNotifications),
    sessionManager: createFakeSessionManager(),
    modelRegistry: undefined,
    model: undefined,
    isIdle: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
    waitForIdle: async () => undefined,
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    navigateTree: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    reload: async () => undefined,
    ...options.ctx,
    ...overrides,
  });

  const pi = {
    on(eventName: string, handler: Handler) {
      const existing = handlers.get(eventName) ?? [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },

    registerCommand(name: string, command: FakeRegisteredCommand) {
      commands.set(name, command);
    },

    registerTool(tool: FakeRegisteredTool) {
      tools.set(tool.name, tool);
      activeTools.add(tool.name);
    },

    appendEntry(customType: string, data?: unknown) {
      appendedEntries.push({ customType, data });
    },

    sendMessage(message: unknown, sendOptions?: unknown) {
      sentMessages.push({ message, options: sendOptions });
    },

    sendUserMessage(content: unknown, sendOptions?: unknown) {
      sentUserMessages.push({ content, options: sendOptions });
    },

    getCommands() {
      return [...commands].map(([name, command]) => ({
        name,
        description: command.description,
        source: "extension",
        sourceInfo: {
          path: "<fake>",
          source: "fake",
          scope: "temporary",
          origin: "top-level",
        },
      }));
    },

    getAllTools() {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.parameters,
        sourceInfo: {
          path: "<fake>",
          source: "fake",
          scope: "temporary",
          origin: "top-level",
        },
      }));
    },

    getActiveTools() {
      return [...activeTools];
    },

    setActiveTools(names: string[]) {
      activeTools.clear();
      for (const name of names) activeTools.add(name);
    },

    getThinkingLevel() {
      return "medium";
    },

    setThinkingLevel() {
      return undefined;
    },

    async exec(command: string, args: string[] = [], execOptions: Record<string, unknown> = {}) {
      if (options.exec) return options.exec(command, args, execOptions);
      return { stdout: "", stderr: "", code: 0, killed: false };
    },

    events: eventBus,
  } as unknown as ExtensionAPI;

  const fakePi: FakePi = {
    pi,
    commands,
    tools,
    handlers,
    activeTools,
    appendedEntries,
    sentMessages,
    sentUserMessages,
    uiNotifications,
    autocompleteProviderFactories,

    async emit(eventName, event = {}, ctx = {}) {
      const eventHandlers = handlers.get(eventName) ?? [];
      const context = createContext(ctx);
      const results = [];

      for (const handler of eventHandlers) {
        const result = await handler(event, context);
        if (result !== undefined) results.push(result);
      }

      return results;
    },

    async runCommand(name, args = "", ctx = {}) {
      const command = commands.get(name);
      if (!command) throw new Error(`Command not registered: ${name}`);
      return command.handler(args, createContext(ctx));
    },

    async runTool(name, params = {}, ctx = {}) {
      const tool = tools.get(name);
      if (!tool?.execute) throw new Error(`Tool not registered or executable: ${name}`);
      return tool.execute(`${name}-fake-call`, params, undefined, undefined, createContext(ctx));
    },

    createContext,
  };

  return fakePi;
}

function createFakeUi(
  autocompleteProviderFactories: FakePi["autocompleteProviderFactories"],
  uiNotifications: FakePi["uiNotifications"],
) {
  return {
    notify: (message: string, type?: "info" | "warning" | "error") => {
      uiNotifications.push({ message, type });
    },
    confirm: async () => false,
    select: async () => undefined,
    input: async () => undefined,
    editor: async () => undefined,
    custom: async () => undefined,
    setStatus: () => undefined,
    setWidget: () => undefined,
    setTitle: () => undefined,
    setEditorText: () => undefined,
    getEditorText: () => "",
    pasteToEditor: () => undefined,
    addAutocompleteProvider: (factory: (current: AutocompleteProvider) => AutocompleteProvider) => {
      autocompleteProviderFactories.push(factory);
    },
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
    theme: {
      fg: (_name: string, text: string) => text,
      bold: (text: string) => text,
      italic: (text: string) => text,
      strikethrough: (text: string) => text,
    },
  };
}

function createFakeSessionManager() {
  return {
    getEntries: () => [],
    getBranch: () => [],
    getLeafId: () => undefined,
    getSessionFile: () => undefined,
    getLabel: () => undefined,
  };
}
