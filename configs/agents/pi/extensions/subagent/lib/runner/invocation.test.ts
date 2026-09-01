import { describe, expect, test } from "bun:test";
import { delimiter, resolve } from "node:path";
import {
  AgentInvocationError,
  type AgentInvocationRequest,
  buildAgentInvocation,
  CHILD_DEPTH_ENV,
  CHILD_EXTENSIONS_ENV,
  CHILD_NO_EXTENSIONS_ENV,
  CHILD_UNSET_ENV,
  childEnvironment,
} from "./invocation";

describe("buildAgentInvocation", () => {
  test("builds a persistent fresh Pi RPC process with exact execution settings", () => {
    // Arrange
    const request = baseRequest({ kind: "fresh", sessionDirectory: "/sessions/children" });

    // Act
    const invocation = buildAgentInvocation(request);

    // Assert
    expect(invocation.command).toBe("pi");
    expect(invocation.cwd).toBe("/repo");
    expect(invocation.args).toEqual([
      "--mode",
      "rpc",
      "-e",
      resolve("/runtime/child-runtime.ts"),
      "--session-dir",
      "/sessions/children",
      "--model",
      "openai/gpt-test",
      "--thinking",
      "high",
      "--append-system-prompt",
      resolve("/tmp/agent-prompt.md"),
    ]);
    expect(invocation.args).not.toContain("-p");
    expect(invocation.env[CHILD_DEPTH_ENV]).toBe("1");
  });

  test("launches the child through the same parent Pi runtime and CLI entrypoint", () => {
    // Arrange
    const request = baseRequest({ kind: "fresh", sessionDirectory: "/sessions/children" });
    request.parentRuntime = { executable: "/runtime/node", entrypoint: "/runtime/pi/dist/cli.js" };

    // Act
    const invocation = buildAgentInvocation(request);

    // Assert
    expect(invocation.command).toBe("/runtime/node");
    expect(invocation.args.slice(0, 3)).toEqual(["/runtime/pi/dist/cli.js", "--mode", "rpc"]);
  });

  test("detects the current Pi runtime when invoked inside Pi", () => {
    // Arrange
    const request = baseRequest({ kind: "fresh", sessionDirectory: "/sessions/children" });
    request.parentEnvironment = { PI_CODING_AGENT: "true" };

    // Act
    const invocation = buildAgentInvocation(request);

    // Assert
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args[0]).toBe(process.argv[1]);
    expect(invocation.args.slice(1, 3)).toEqual(["--mode", "rpc"]);
  });

  test("rejects an invalid explicit parent runtime with a typed error", () => {
    // Arrange
    const request = baseRequest({ kind: "fresh", sessionDirectory: "/sessions/children" });
    request.parentRuntime = { executable: "", entrypoint: "/runtime/pi/dist/cli.js" };

    // Act
    const build = () => buildAgentInvocation(request);

    // Assert
    expect(build).toThrow(AgentInvocationError);
    expect(build).toThrow("parent runtime executable must not be empty");
  });

  test("builds a full parent-session fork", () => {
    // Arrange
    const request = baseRequest({
      kind: "fork",
      sessionDirectory: "/sessions/children",
      parentSessionFile: "/sessions/parent.jsonl",
    });

    // Act
    const invocation = buildAgentInvocation(request);

    // Assert
    expect(invocation.args).toContain("--session-dir");
    expect(invocation.args).toContain("/sessions/children");
    expect(invocation.args).toContain("--fork");
    expect(invocation.args).toContain("/sessions/parent.jsonl");
    expect(invocation.args).not.toContain("--session");
  });

  test("recovers one resident agent with --session and no fresh or fork flags", () => {
    // Arrange
    const request = baseRequest({ kind: "recovered", sessionFile: "/sessions/child.jsonl" });

    // Act
    const invocation = buildAgentInvocation(request);

    // Assert
    expect(invocation.args).toContain("--session");
    expect(invocation.args).toContain("/sessions/child.jsonl");
    expect(invocation.args).not.toContain("--session-dir");
    expect(invocation.args).not.toContain("--fork");
  });

  test("uses configured child extensions without changing the inherited authentication environment", () => {
    // Arrange
    const request = baseRequest({ kind: "fresh", sessionDirectory: "/sessions/children" });
    request.parentEnvironment = {
      [CHILD_NO_EXTENSIONS_ENV]: "true",
      [CHILD_EXTENSIONS_ENV]: ["./one.ts", "./two.ts"].join(delimiter),
      PROVIDER_API_KEY: "inherited-value",
    };

    // Act
    const invocation = buildAgentInvocation(request);

    // Assert
    expect(invocation.args).toContain("--no-extensions");
    expect(invocation.args.filter((argument) => argument === "-e")).toHaveLength(3);
    expect(invocation.env.PROVIDER_API_KEY).toBe("inherited-value");
    expect(Object.keys(invocation.env)).toEqual(
      expect.arrayContaining([CHILD_NO_EXTENSIONS_ENV, CHILD_EXTENSIONS_ENV, "PROVIDER_API_KEY", CHILD_DEPTH_ENV]),
    );
  });

  test("rejects incomplete session paths before spawning", () => {
    // Arrange
    const request = baseRequest({ kind: "fork", sessionDirectory: "/sessions/children", parentSessionFile: "" });

    // Act / Assert
    expect(() => buildAgentInvocation(request)).toThrow("parent session file must not be empty");
  });
});

describe("childEnvironment", () => {
  test("inherits environment, increments depth, and removes only explicitly unset names", () => {
    // Arrange
    const parent = {
      [CHILD_DEPTH_ENV]: "2",
      [CHILD_UNSET_ENV]: "PARENT_SOCKET, RESOLVED_AUTH",
      PARENT_SOCKET: "/private/control.sock",
      RESOLVED_AUTH: "do-not-forward",
      HOME: "/home/test",
    };

    // Act
    const child = childEnvironment(parent);

    // Assert
    expect(child).toEqual({
      [CHILD_DEPTH_ENV]: "3",
      [CHILD_UNSET_ENV]: "PARENT_SOCKET, RESOLVED_AUTH",
      HOME: "/home/test",
    });
    expect(parent.PARENT_SOCKET).toBe("/private/control.sock");
  });
});

function baseRequest(session: AgentInvocationRequest["session"]): AgentInvocationRequest {
  return {
    cwd: "/repo",
    session,
    execution: { provider: "openai", model: "gpt-test", effort: "high" },
    childRuntimeExtensionPath: "/runtime/child-runtime.ts",
    systemPromptPath: "/tmp/agent-prompt.md",
    parentEnvironment: {},
  };
}
