import { randomBytes, timingSafeEqual } from "node:crypto";
import type { BridgeClientRecord, CodexMultiAuthBackend, MultiAuthServer } from "./backend";

const LOOPBACK_HOST = "127.0.0.1";

export type CodexMultiAuthRuntime = {
  prepare(): Promise<CodexMultiAuthActivation>;
};

export type CodexMultiAuthActivation =
  | { state: "inactive"; reason: "no-accounts" }
  | {
      state: "ready";
      accountCount: number;
      bridgeBaseUrl: string;
      bridgeClientApiKey: string;
      start(): Promise<void>;
      close(): Promise<void>;
    };

export function createCodexMultiAuthRuntime(backend: CodexMultiAuthBackend): CodexMultiAuthRuntime {
  return {
    async prepare() {
      const accountManager = await backend.loadAccountManager();
      const accountCount = accountManager.getAccountCount();
      if (accountCount === 0) return { state: "inactive", reason: "no-accounts" };

      const [runtimePort, bridgePort] = await Promise.all([
        backend.reserveLoopbackPort(),
        backend.reserveLoopbackPort(),
      ]);
      const runtimeClientApiKey = createEphemeralToken("runtime");
      const bridgeClientApiKey = createEphemeralToken("pi");
      let runtimeProxy: MultiAuthServer | undefined;
      let localBridge: MultiAuthServer | undefined;
      let startPromise: Promise<void> | undefined;

      return {
        state: "ready",
        accountCount,
        bridgeBaseUrl: `http://${LOOPBACK_HOST}:${bridgePort}/v1`,
        bridgeClientApiKey,
        start() {
          startPromise ??= (async () => {
            runtimeProxy = await backend.startRuntimeProxy({
              host: LOOPBACK_HOST,
              port: runtimePort,
              clientApiKey: runtimeClientApiKey,
              accountManager,
            });

            try {
              localBridge = await backend.startLocalBridge({
                host: LOOPBACK_HOST,
                port: bridgePort,
                runtimeBaseUrl: runtimeProxy.baseUrl,
                runtimeClientApiKey,
                requireAuth: true,
                verifyBearerToken: createEphemeralBearerVerifier(bridgeClientApiKey),
              });
            } catch (error) {
              await runtimeProxy.close();
              runtimeProxy = undefined;
              throw error;
            }
          })();
          return startPromise;
        },
        async close() {
          await Promise.allSettled([localBridge?.close(), runtimeProxy?.close()]);
          localBridge = undefined;
          runtimeProxy = undefined;
        },
      };
    },
  };
}

export function createEphemeralBearerVerifier(expectedToken: string) {
  return async (authorizationHeader: string | null, now = Date.now()): Promise<BridgeClientRecord | null> => {
    const suppliedToken = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!suppliedToken || !tokensMatch(suppliedToken, expectedToken)) return null;

    return {
      id: "pi-ephemeral-client",
      label: "Pi",
      prefix: expectedToken.slice(0, 18),
      tokenHash: "ephemeral",
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
    };
  };
}

function createEphemeralToken(purpose: string): string {
  return `cma_${purpose}_${randomBytes(32).toString("base64url")}`;
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
