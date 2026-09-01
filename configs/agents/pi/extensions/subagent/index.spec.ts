import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_ALT_MODEL_ID,
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_PLANS_BY_DEPTH_ENV,
  FAUX_RESPONSE_PLANS_BY_PROMPT_ENV,
  FAUX_TOKENS_PER_SECOND_BY_DEPTH_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import { writeArtifact } from "./lib/artifacts/artifacts";
import { CHILD_EXTENSIONS_ENV, CHILD_NO_EXTENSIONS_ENV } from "./lib/runner/invocation";

const extensionPath = "configs/agents/pi/extensions/subagent";
const fauxProviderExtensionPath = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";
const toolNames = [
  "agent_spawn",
  "agent_send",
  "agent_followup",
  "agent_wait",
  "agent_interrupt",
  "agent_list",
  "agent_close",
] as const;

type JsonObject = Record<string, unknown>;

describe("persistent subagent Pi RPC E2E", () => {
  let harnesses: PiRpcHarness[] = [];
  let tempDir: string | undefined;

  afterEach(async () => {
    await Promise.allSettled(harnesses.map((harness) => harness.stop()));
    harnesses = [];
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("executes the stable lifecycle tools through Pi with persistent child sessions", async () => {
    // Arrange
    const fixture = await createFixture();
    const childText = "Persistent child completion ".repeat(20);
    const steerSentinel = "STEER-SENTINEL-ALPHA-7D91";
    const rootPlan = [
      toolStep("agent_spawn", {
        task_name: "alpha",
        subagent_type: "worker",
        prompt: "Complete deterministic assignment alpha.",
        execution: { effort: "off" },
      }),
      toolStep("agent_list", {}),
      toolStep("agent_send", {
        target: "/root/alpha",
        message: `Include the running-message handoff ${steerSentinel}.`,
      }),
      toolStep("agent_wait", { targets: ["/root/alpha"], timeout_seconds: 30 }),
      toolStep("agent_followup", {
        target: "/root/alpha",
        message: "Complete generation two with the alternate model.",
        execution: { provider: FAUX_PROVIDER_NAME, model: FAUX_ALT_MODEL_ID, effort: "off" },
      }),
      toolStep("agent_wait", { targets: ["/root/alpha"], timeout_seconds: 30 }),
      toolStep("agent_spawn", {
        task_name: "beta",
        subagent_type: "worker",
        prompt: "Start interruptible deterministic work beta.",
        execution: { effort: "off" },
      }),
      toolStep("agent_interrupt", { target: "/root/beta" }),
      toolStep("agent_followup", { target: "/root/beta", message: "Resume after interruption." }),
      toolStep("agent_wait", { targets: ["/root/beta"], timeout_seconds: 30 }),
      toolStep("agent_close", { target: "/root/alpha" }),
      toolStep("agent_close", { target: "/root/beta" }),
      { text: "Root lifecycle complete." },
    ];
    const plans = { 0: rootPlan };
    const promptPlans = {
      "/root/alpha": [
        { text: `${childText.repeat(3)}alpha-initial` },
        { contextEcho: { sentinel: steerSentinel, prefix: "STEER_ECHO" } },
        { text: "ALPHA-FOLLOWUP-ALT-MODEL" },
      ],
      "/root/beta": [{ text: `${childText.repeat(3)}beta-interruptible` }, { text: "BETA-RESUMED-AFTER-INTERRUPT" }],
    };
    const harness = await startHarness(fixture, plans, { 0: 0, 1: 100 }, true, [], promptPlans);

    // Act
    const prompt = await harness.request({ type: "prompt", message: "Run the deterministic lifecycle." });
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 120_000);
    const entries = await harness.request({ type: "get_entries" });

    // Assert
    expect(prompt.success).toBe(true);
    expect(eventText(agentEnd)).toContain("Root lifecycle complete.");
    const toolEnds = harness.events.filter((event) => event.type === "tool_execution_end");
    expect(toolEnds.map((event) => event.toolName)).toEqual(rootPlan.flatMap(stepToolName));
    for (const name of toolNames) expect(toolEnds.some((event) => event.toolName === name)).toBe(true);
    expect(toolEvent(toolEnds, "agent_spawn", 0)).toContain('"status":"running"');
    expect(toolEvent(toolEnds, "agent_spawn", 0)).toContain('"agentPath":"/root/alpha"');
    expect(toolEvent(toolEnds, "agent_list")).toContain('"status":"running"');
    expect(toolEvent(toolEnds, "agent_send")).toContain('"delivery":"steered"');
    expect(toolEvent(toolEnds, "agent_wait", 0)).toContain("subagent-artifact:");
    expect(toolEvent(toolEnds, "agent_wait", 0)).toContain(`STEER_ECHO ${steerSentinel}`);
    expect(toolEvent(toolEnds, "agent_wait", 1)).toContain("ALPHA-FOLLOWUP-ALT-MODEL");
    expect(
      toolEnds
        .filter((event) => event.toolName === "agent_wait")
        .every((event) => !JSON.stringify(event).includes('"timedOut":true')),
    ).toBe(true);
    expect(toolEvent(toolEnds, "agent_followup", 0)).toContain('"assignmentId":');
    expect(toolEvent(toolEnds, "agent_followup", 0)).toContain(FAUX_ALT_MODEL_ID);
    expect(toolEvent(toolEnds, "agent_interrupt")).toContain('"agentPath":"/root/beta"');
    expect(toolEvent(toolEnds, "agent_interrupt")).toContain('"status":"interrupted"');
    expect(toolEvent(toolEnds, "agent_interrupt")).toContain('"phase":"settled"');
    expect(toolEvent(toolEnds, "agent_close", 0)).toContain('"status":"closed"');
    expect(JSON.stringify(entries)).toContain('"event":"interrupted"');
    const alphaEntries = runtimeEntries(entries).filter((entry) => entry.agentPath === "/root/alpha");
    const alphaSpawned = alphaEntries.filter((entry) => entry.event === "spawned");
    expect(alphaSpawned).toHaveLength(1);
    expect(typeof alphaSpawned[0]?.sessionFile).toBe("string");
    const alphaSessionFile = alphaSpawned[0]?.sessionFile as string;
    const alphaSessionText = await readFile(alphaSessionFile, "utf8");
    expect(alphaSessionText).toContain(`STEER_ECHO ${steerSentinel}`);
    expect(alphaSessionText).toContain("ALPHA-FOLLOWUP-ALT-MODEL");
    expect(alphaEntries.filter((entry) => entry.event === "started").map((entry) => entry.generation)).toEqual([1, 2]);
    expect(
      alphaEntries.some(
        (entry) => entry.event === "execution_changed" && JSON.stringify(entry).includes(FAUX_ALT_MODEL_ID),
      ),
    ).toBe(true);
    const interruptIndex = toolEnds.findIndex((event) => event.toolName === "agent_interrupt");
    const resumeIndex = toolEnds.findIndex(
      (event, index) => index > interruptIndex && event.toolName === "agent_followup",
    );
    const resumedWaitIndex = toolEnds.findIndex(
      (event, index) => index > resumeIndex && event.toolName === "agent_wait",
    );
    expect(interruptIndex).toBeGreaterThanOrEqual(0);
    expect(resumeIndex).toBeGreaterThan(interruptIndex);
    expect(resumedWaitIndex).toBeGreaterThan(resumeIndex);
    expect(toolEvent(toolEnds, "agent_wait", 2)).toContain("BETA-RESUMED-AFTER-INTERRUPT");
    const firstSpawnEnd = harness.events.findIndex(
      (event) => event.type === "tool_execution_end" && event.toolName === "agent_spawn",
    );
    const firstFinalAnswer = harness.events.findIndex(isFinalAnswerEvent);
    expect(firstSpawnEnd).toBeGreaterThanOrEqual(0);
    expect(firstFinalAnswer).toBeGreaterThan(firstSpawnEnd);
    expect(JSON.stringify(harness.events.filter(isFinalAnswerEvent))).not.toMatch(
      /PI_SUBAGENT|control\.sock|ephemeral/i,
    );
    expect(harness.stderr()).toBe("");
  }, 130_000);

  test("retrieves the omitted head of a greater-than-12-KiB artifact through agent_wait pagination", async () => {
    // Arrange
    const fixture = await createFixture();
    const sentinel = "OMITTED-HEAD-SENTINEL";
    const providerSecret = "provider-token-sentinel-123";
    const stored = await writeArtifact({
      cwd: fixture.projectRoot,
      agentDir: fixture.piAgentDir,
      agentPath: "/root/large",
      agentId: "large-agent",
      kind: "completion",
      content: `${sentinel}\n${providerSecret}\n${"tail-detail-".repeat(2_000)}`,
    });
    const harness = await startHarness(
      fixture,
      {
        0: [
          toolStep("agent_wait", {
            operation: "read_artifact",
            artifact_ref: stored.reference,
            page_bytes: 16 * 1024,
            page_lines: 120,
          }),
          { text: "Artifact retrieval complete." },
        ],
      },
      { 0: 0 },
    );

    // Act
    const prompt = await harness.request({ type: "prompt", message: "Retrieve the prepared artifact." });
    await harness.waitForEvent((event) => event.type === "agent_end", 30_000);
    const event = toolEvent(
      harness.events.filter((candidate) => candidate.type === "tool_execution_end"),
      "agent_wait",
    );

    // Assert
    expect(prompt.success).toBe(true);
    expect(stored.bytes).toBeGreaterThan(12 * 1024);
    expect(event).toContain(sentinel);
    expect(event).toContain("[REDACTED]");
    expect(event).not.toContain(providerSecret);
    expect(event).toContain('"eof":false');
    expect(event).toContain('"nextCursor":');
    expect(event).not.toContain(stored.path);
  }, 40_000);

  test("idle residents unload for runnable work and close remains terminal", async () => {
    // Arrange
    const fixture = await createFixture();
    await writeFile(
      join(fixture.projectRoot, "pi-subagent.json"),
      JSON.stringify({ runtime: { maxActiveAgents: 1, maxResidentAgents: 1, maxDepth: 3 } }),
    );
    const rootPlan = [
      toolStep("agent_spawn", {
        task_name: "capacity-a",
        subagent_type: "worker",
        prompt: "Occupy the only resident slot.",
        execution: { effort: "off" },
      }),
      toolStep("agent_wait", { targets: ["/root/capacity-a"], timeout_seconds: 30 }),
      toolStep("agent_spawn", {
        task_name: "capacity-b",
        subagent_type: "worker",
        prompt: "Start after the idle resident is automatically unloaded.",
        execution: { effort: "off" },
      }),
      toolStep("agent_close", { target: "/root/capacity-a" }),
      toolStep("agent_wait", { targets: ["/root/capacity-b"], timeout_seconds: 30 }),
      toolStep("agent_close", { target: "/root/capacity-b" }),
      toolStep("agent_followup", { target: "/root/capacity-a", message: "This must remain closed." }),
      toolStep("agent_list", {}),
      { text: "Capacity lifecycle complete." },
    ];
    const harness = await startHarness(fixture, { 0: rootPlan }, { 0: 0, 1: 0 }, true, [], {
      "/root/capacity-a": [{ text: "CAPACITY-A-COMPLETE" }],
      "/root/capacity-b": [{ text: "CAPACITY-B-STARTED-AFTER-EVICTION" }],
    });

    // Act
    const prompt = await harness.request({ type: "prompt", message: "Exercise resident eviction and terminal close." });
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 90_000);

    // Assert
    expect(prompt.success).toBe(true);
    expect(eventText(agentEnd)).toContain("Capacity lifecycle complete.");
    const toolEnds = harness.events.filter((event) => event.type === "tool_execution_end");
    expect(toolEvent(toolEnds, "agent_spawn", 1)).toContain('"status":"running"');
    expect(toolEvent(toolEnds, "agent_close", 0)).toContain('"status":"closed"');
    expect(toolEvent(toolEnds, "agent_wait", 1)).toContain("CAPACITY-B-STARTED-AFTER-EVICTION");
    expect(toolEvent(toolEnds, "agent_followup")).toContain('"kind":"closed"');
    const listed = toolEvent(toolEnds, "agent_list");
    expect(listed).toContain('"agentPath":"/root/capacity-a"');
    expect(listed).toContain('"status":"closed"');
    expect(harness.stderr()).toBe("");
  }, 100_000);

  test("restores the active parent branch as unloaded and lazily respawns follow-up", async () => {
    // Arrange
    const fixture = await createFixture();
    const first = await startHarness(
      fixture,
      {
        0: [
          toolStep("agent_spawn", {
            task_name: "restored",
            subagent_type: "worker",
            prompt: "Create a recoverable session.",
            execution: { effort: "off" },
          }),
          toolStep("agent_wait", { targets: ["/root/restored"], timeout_seconds: 30 }),
          { text: "Initial parent complete." },
        ],
        1: [{ text: "Initial child complete." }],
      },
      { 0: 0, 1: 0 },
      false,
    );
    await first.request({ type: "prompt", message: "Create the recoverable child." });
    await first.waitForEvent((event) => event.type === "agent_end", 60_000);
    const state = await first.request({ type: "get_state" });
    const sessionFile = sessionFileFromState(state);
    await first.stop();
    harnesses = harnesses.filter((candidate) => candidate !== first);
    const second = await startHarness(
      fixture,
      {
        0: [
          toolStep("agent_list", {}),
          toolStep("agent_followup", { target: "/root/restored", message: "Resume the saved session." }),
          toolStep("agent_wait", { targets: ["/root/restored"], timeout_seconds: 30 }),
          toolStep("agent_close", { target: "/root/restored" }),
          { text: "Restored parent complete." },
        ],
        1: [{ text: "Recovered child generation complete." }],
      },
      { 0: 0, 1: 0 },
      false,
      ["--session", sessionFile],
    );

    // Act
    const prompt = await second.request({ type: "prompt", message: "Resume and close the restored child." });
    const agentEnd = await second.waitForEvent((event) => event.type === "agent_end", 90_000);

    // Assert
    expect(prompt.success).toBe(true);
    expect(eventText(agentEnd)).toContain("Restored parent complete.");
    const toolEnds = second.events.filter((event) => event.type === "tool_execution_end");
    expect(toolEvent(toolEnds, "agent_list")).toContain('"status":"unloaded"');
    expect(toolEvent(toolEnds, "agent_followup")).toContain('"status":"running"');
    expect(toolEvent(toolEnds, "agent_wait")).toContain("Recovered child generation complete.");
    expect(toolEvent(toolEnds, "agent_close")).toContain('"status":"closed"');
    expect(second.stderr()).toBe("");
  }, 120_000);

  test("routes nested spawn, send, wait, and completion through authenticated IPC to the direct parent", async () => {
    // Arrange
    const fixture = await createFixture();
    await writeFile(
      join(fixture.projectRoot, "pi-subagent.json"),
      JSON.stringify({ runtime: { maxActiveAgents: 3, maxResidentAgents: 6, maxDepth: 2 } }),
    );
    const nestedSentinel = "NESTED-OMITTED-HEAD-SENTINEL";
    const leafPayloadSentinel = "LEAF-FINAL-PAYLOAD-SENTINEL-42C9";
    const nestedArtifact = await writeArtifact({
      cwd: fixture.projectRoot,
      agentDir: fixture.piAgentDir,
      agentPath: "/root/coordinator/leaf",
      agentId: "leaf-artifact-owner",
      kind: "completion",
      content: `${nestedSentinel}\n${"nested-tail-detail-".repeat(2_000)}`,
    });
    const plans = {
      0: [
        toolStep("agent_spawn", {
          task_name: "coordinator",
          subagent_type: "worker",
          prompt: "Delegate one deterministic nested leaf and wait for it.",
          execution: { effort: "off" },
        }),
        toolStep("agent_wait", { targets: ["/root/coordinator"], timeout_seconds: 30 }),
        toolStep("agent_close", { target: "/root/coordinator" }),
        { text: "Nested root complete." },
      ],
    };
    const promptPlans = {
      "/root/coordinator": [
        toolStep("agent_spawn", {
          task_name: "leaf",
          subagent_type: "worker",
          prompt: "Return the nested leaf completion.",
          execution: { effort: "off" },
        }),
        toolStep("agent_send", { target: "/root/coordinator/leaf", message: "Direct-parent nested handoff." }),
        toolStep("agent_wait", { targets: ["/root/coordinator/leaf"], timeout_seconds: 30 }),
        toolStep("agent_wait", {
          operation: "read_artifact",
          artifact_ref: nestedArtifact.reference,
          page_bytes: 16 * 1024,
          page_lines: 120,
        }),
        { finalAnswerEcho: { payloadSentinel: leafPayloadSentinel, prefix: "DIRECT_PARENT_ECHO" } },
      ],
      "/root/coordinator/leaf": [
        { text: `Nested leaf completion reached its direct parent: ${leafPayloadSentinel}` },
        { text: "Nested leaf mail received." },
      ],
    };
    const harness = await startHarness(fixture, plans, { 0: 0, 1: 0 }, true, [], promptPlans);

    // Act
    const prompt = await harness.request({ type: "prompt", message: "Run nested deterministic orchestration." });
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 120_000);
    const sessionText = await readSessionText(fixture.piAgentDir);

    // Assert
    expect(prompt.success).toBe(true);
    expect(eventText(agentEnd)).toContain("Nested root complete.");
    const rootWait = harness.events
      .filter((event) => event.type === "tool_execution_end" && event.toolName === "agent_wait")
      .map((event) => JSON.stringify(event))
      .join("\n");
    expect(rootWait).toContain(`DIRECT_PARENT_ECHO ${leafPayloadSentinel} sender=/root/coordinator/leaf`);
    expect(rootWait).not.toContain(`MISSING_FINAL_ANSWER ${leafPayloadSentinel}`);
    expect(rootWait).toContain("subagent-artifact:");
    expect(nestedArtifact.bytes).toBeGreaterThan(12 * 1024);
    expect(sessionText).toContain(nestedSentinel);
    expect(sessionText).toContain("Message Type: FINAL_ANSWER");
    expect(sessionText).toContain(leafPayloadSentinel);
    expect(sessionText).toContain('"operation":"read_artifact"');
    expect(sessionText).not.toContain(nestedArtifact.path);
    expect(harness.stderr()).toBe("");
  }, 130_000);

  test("suppresses the installed-style parent boundary when the explicit child runtime loads normally", async () => {
    // Arrange
    const fixture = await createFixture();
    const installedExtensions = join(fixture.piAgentDir, "extensions");
    await mkdir(installedExtensions, { recursive: true });
    await symlink(resolve(extensionPath), join(installedExtensions, "subagent"), "dir");
    const rootPlan = [
      toolStep("agent_spawn", {
        task_name: "collision-check",
        subagent_type: "worker",
        prompt: "Audit the child collaboration catalog under normal extension loading.",
        execution: { effort: "off" },
      }),
      toolStep("agent_wait", { targets: ["/root/collision-check"], timeout_seconds: 30 }),
      toolStep("agent_close", { target: "/root/collision-check" }),
      { text: "Collision audit complete." },
    ];
    const harness = await startHarness(
      fixture,
      { 0: rootPlan },
      { 0: 0, 1: 0 },
      true,
      [],
      {
        "/root/collision-check": [
          toolStep("agent_list", {}),
          { toolCatalogAudit: { expected: [...toolNames], forbidden: ["agent"] } },
        ],
      },
      false,
    );

    // Act
    const prompt = await harness.request({ type: "prompt", message: "Run the installed-style collision audit." });
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 90_000);

    // Assert
    expect(prompt.success).toBe(true);
    expect(eventText(agentEnd)).toContain("Collision audit complete.");
    const wait = toolEvent(
      harness.events.filter((event) => event.type === "tool_execution_end"),
      "agent_wait",
    );
    expect(wait).toContain(`TOOL_CATALOG_AUDIT exact=true names=${toolNames.join(",")}`);
    expect(wait).not.toContain("TOOL_CATALOG_AUDIT exact=false");
    expect(harness.events.filter((event) => event.type === "extension_error")).toEqual([]);
    expect(harness.stderr()).toBe("");
  }, 100_000);

  async function createFixture() {
    tempDir = await mkdtemp(join(tmpdir(), "pi-subagent-e2e-"));
    const projectRoot = join(tempDir, "repo");
    const piAgentDir = join(tempDir, "pi-agent");
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(piAgentDir, { recursive: true });
    return { projectRoot, piAgentDir };
  }

  async function startHarness(
    fixture: { projectRoot: string; piAgentDir: string },
    plans: Record<number, unknown[]>,
    tokenRates: Record<number, number>,
    noSession = true,
    sessionArgs: string[] = [],
    promptPlans?: Record<string, unknown[]>,
    childNoExtensions = true,
  ): Promise<PiRpcHarness> {
    const harness = await startPiRpcHarness({
      cwd: fixture.projectRoot,
      extensionPath: resolve(extensionPath),
      noSession,
      args: [
        "--approve",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        resolve(fauxProviderExtensionPath),
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
        ...sessionArgs,
      ],
      env: {
        PI_CODING_AGENT_DIR: fixture.piAgentDir,
        [FAUX_API_KEY_ENV]: "provider-token-sentinel-123",
        [FAUX_RESPONSE_PLANS_BY_DEPTH_ENV]: JSON.stringify(plans),
        ...(promptPlans ? { [FAUX_RESPONSE_PLANS_BY_PROMPT_ENV]: JSON.stringify(promptPlans) } : {}),
        [FAUX_TOKENS_PER_SECOND_BY_DEPTH_ENV]: JSON.stringify(tokenRates),
        ...(childNoExtensions ? { [CHILD_NO_EXTENSIONS_ENV]: "1" } : {}),
        [CHILD_EXTENSIONS_ENV]: resolve(fauxProviderExtensionPath),
      },
    });
    harnesses.push(harness);
    return harness;
  }
});

function toolStep(name: string, arguments_: Record<string, unknown>) {
  return { toolCalls: [{ name, arguments: arguments_ }] };
}

function stepToolName(step: unknown): string[] {
  if (!step || typeof step !== "object" || !("toolCalls" in step)) return [];
  const calls = (step as { toolCalls: Array<{ name: string }> }).toolCalls;
  return calls.map((call) => call.name);
}

function toolEvent(events: JsonObject[], name: string, index = 0): string {
  const event = events.filter((candidate) => candidate.toolName === name)[index];
  return JSON.stringify(event ?? {});
}

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

function runtimeEntries(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(runtimeEntries);
  if (!value || typeof value !== "object") return [];
  const record = value as JsonObject;
  const own = record.version === 2 && typeof record.event === "string" ? [record] : [];
  return [...own, ...Object.values(record).flatMap(runtimeEntries)];
}

function isFinalAnswerEvent(event: JsonObject): boolean {
  return event.type === "message_end" && JSON.stringify(event).includes("Message Type: FINAL_ANSWER");
}

async function readSessionText(agentDir: string): Promise<string> {
  const directory = join(agentDir, "subagent-sessions");
  const names = await readdir(directory, { recursive: true });
  const files = names.filter((name) => name.endsWith(".jsonl"));
  return (await Promise.all(files.map(async (name) => await readFile(join(directory, name), "utf8")))).join("\n");
}

function sessionFileFromState(response: JsonObject): string {
  const data = response.data;
  if (!data || typeof data !== "object" || typeof (data as JsonObject).sessionFile !== "string") {
    throw new Error("Pi RPC get_state did not return a session file");
  }
  return (data as JsonObject).sessionFile as string;
}
