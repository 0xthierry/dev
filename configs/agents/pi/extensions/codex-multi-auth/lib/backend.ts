import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type MultiAuthAccountManager = {
  getAccountCount(): number;
};

export type MultiAuthServer = {
  baseUrl: string;
  close(): Promise<void>;
};

export type StartRuntimeProxyOptions = {
  host: string;
  port: number;
  clientApiKey: string;
  accountManager: MultiAuthAccountManager;
};

export type BridgeClientRecord = {
  id: string;
  label: string;
  prefix: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type StartLocalBridgeOptions = {
  host: string;
  port: number;
  runtimeBaseUrl: string;
  runtimeClientApiKey: string;
  requireAuth: true;
  verifyBearerToken(authorizationHeader: string | null, now?: number): Promise<BridgeClientRecord | null>;
};

export type CodexMultiAuthBackend = {
  loadAccountManager(): Promise<MultiAuthAccountManager>;
  reserveLoopbackPort(): Promise<number>;
  startRuntimeProxy(options: StartRuntimeProxyOptions): Promise<MultiAuthServer>;
  startLocalBridge(options: StartLocalBridgeOptions): Promise<MultiAuthServer>;
};

type AccountsModule = {
  AccountManager: {
    loadFromDisk(): Promise<MultiAuthAccountManager>;
  };
};

type RuntimeProxyModule = {
  startRuntimeRotationProxy(options: StartRuntimeProxyOptions): Promise<MultiAuthServer>;
};

type LocalBridgeModule = {
  startLocalBridge(options: StartLocalBridgeOptions): Promise<MultiAuthServer>;
};

export async function createCodexMultiAuthBackend(): Promise<CodexMultiAuthBackend> {
  const packageRoot = dirname(createRequire(import.meta.url).resolve("codex-multi-auth/package.json"));
  const moduleUrl = (name: string) => pathToFileURL(join(packageRoot, "dist", "lib", name)).href;
  const [accounts, runtimeProxy, localBridge] = (await Promise.all([
    import(moduleUrl("accounts.js")),
    import(moduleUrl("runtime-rotation-proxy.js")),
    import(moduleUrl("local-bridge.js")),
  ])) as [AccountsModule, RuntimeProxyModule, LocalBridgeModule];

  return {
    loadAccountManager: () => accounts.AccountManager.loadFromDisk(),
    reserveLoopbackPort,
    startRuntimeProxy: (options) => runtimeProxy.startRuntimeRotationProxy(options),
    startLocalBridge: (options) => localBridge.startLocalBridge(options),
  };
}

export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port");
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
