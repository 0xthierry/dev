import { afterEach, describe, expect, mock, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDirectAppServerArgs,
  resolveOfficialComputerUseClient,
  verifyOfficialDirectBroker,
} from "./direct-broker";

const CLIENT_RELATIVE_PATH = "Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
const roots: string[] = [];

afterEach(async () => {
  mock.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeClient(appPath: string): Promise<string> {
  const clientPath = path.join(appPath, CLIENT_RELATIVE_PATH);
  await mkdir(path.dirname(clientPath), { recursive: true });
  await writeFile(clientPath, "signed fixture\n", { mode: 0o700 });
  return clientPath;
}

function signedBy(team = "2DC432GLL2") {
  return mock((_command: string, args: string[]) => {
    if (args.includes("--verify")) return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: `TeamIdentifier=${team}\n` };
  });
}

function captureError(operation: () => unknown): Error | undefined {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return undefined;
}

describe("official direct broker verification", () => {
  test("builds a no-model, no-plugin app-server invocation around the reviewed client path", () => {
    // Arrange
    const clientPath = "/reviewed/SkyComputerUseClient";
    const workDir = "/private/broker-work";

    // Act
    const args = buildDirectAppServerArgs(workDir, clientPath);
    const serialized = args.join(" ");

    // Assert
    expect(serialized).toContain('model_provider="direct_disabled"');
    expect(serialized).toContain("127.0.0.1:9/v1");
    expect(serialized).toContain("features.plugins=false");
    expect(serialized).toContain("features.remote_control=false");
    expect(serialized).toContain('history.persistence="none"');
    expect(serialized).toContain(`command = ${JSON.stringify(clientPath)}`);
    expect(serialized).toContain(`cwd = ${JSON.stringify(workDir)}`);
    expect(serialized.endsWith("app-server --stdio")).toBe(true);
    expect(serialized).not.toMatch(/\bexec\b/);
  });

  test("resolves and verifies the reviewed per-user component layout", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "cu-current-resolution."));
    roots.push(root);
    const appPath = path.join(root, ".codex", "computer-use", "Codex Computer Use.app");
    const clientPath = await makeClient(appPath);
    const runSync = signedBy();

    // Act
    const resolved = resolveOfficialComputerUseClient({
      userHome: root,
      legacyPluginRoot: path.join(root, "missing-legacy"),
      runSync,
    });

    // Assert
    expect(resolved).toEqual({
      appPath: realpathSync(appPath),
      clientPath: realpathSync(clientPath),
      layout: "installed-component",
    });
    expect(runSync).toHaveBeenCalledWith("/usr/bin/codesign", ["--verify", "--strict", realpathSync(clientPath)]);
  });

  test("fails closed for missing, symlinked, or incorrectly signed clients", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "cu-fail-closed."));
    roots.push(root);
    const missingOptions = {
      userHome: root,
      legacyPluginRoot: path.join(root, "missing-legacy"),
      runSync: signedBy(),
    };
    const actualApp = path.join(root, "elsewhere", "Codex Computer Use.app");
    await makeClient(actualApp);
    const expectedParent = path.join(root, ".codex", "computer-use");
    await mkdir(expectedParent, { recursive: true });
    await symlink(actualApp, path.join(expectedParent, "Codex Computer Use.app"));

    // Act
    const missingError = captureError(() =>
      resolveOfficialComputerUseClient({ ...missingOptions, userHome: path.join(root, "empty-home") }),
    );
    const symlinkError = captureError(() => resolveOfficialComputerUseClient(missingOptions));
    await rm(path.join(expectedParent, "Codex Computer Use.app"));
    await makeClient(path.join(expectedParent, "Codex Computer Use.app"));
    const wrongTeamError = captureError(() =>
      resolveOfficialComputerUseClient({ ...missingOptions, runSync: signedBy("NOT_OPENAI") }),
    );

    // Assert
    expect(missingError?.message).toMatch(/was not found in a supported location/);
    expect(symlinkError?.message).toMatch(/was not canonical/);
    expect(wrongTeamError?.message).toMatch(/not signed by the expected OpenAI team/);
  });

  test("verifies the fixed ChatGPT Codex binary and reports its exact version and client build", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "cu-broker-verification."));
    roots.push(root);
    const appPath = path.join(root, ".codex", "computer-use", "Codex Computer Use.app");
    await makeClient(appPath);
    const runSync = mock((command: string, args: string[]) => {
      if (command === "/usr/bin/codesign" && args.includes("--verify")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "/usr/bin/codesign") {
        return { status: 0, stdout: "", stderr: "TeamIdentifier=2DC432GLL2\n" };
      }
      if (command === "/Applications/ChatGPT.app/Contents/Resources/codex") {
        return { status: 0, stdout: "codex-cli 1.2.3\n", stderr: "" };
      }
      return { status: 0, stdout: "1000366\n", stderr: "" };
    });

    // Act
    const result = verifyOfficialDirectBroker({
      userHome: root,
      legacyPluginRoot: path.join(root, "missing-legacy"),
      runSync,
    });

    // Assert
    expect(result.brokerVersion).toBe("codex-cli 1.2.3");
    expect(result.clientBuild).toBe("1000366");
    expect(runSync).toHaveBeenCalledWith("/Applications/ChatGPT.app/Contents/Resources/codex", ["--version"]);
  });
});
