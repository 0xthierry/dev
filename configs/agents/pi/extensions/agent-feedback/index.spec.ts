import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = import.meta.dir;
const fauxProviderExtensionPath = resolve(import.meta.dir, "../_shared/testing/faux-provider-extension.ts");
const expectedResponseText = "agent feedback e2e complete";

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("agent-feedback extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempProject: string | undefined;
  let tempHome: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempProject) await rm(tempProject, { recursive: true, force: true });
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
    tempProject = undefined;
    tempHome = undefined;
  });

  test("writes model feedback through the agent tool loop", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-agent-feedback-project-"));
    tempHome = await mkdtemp(join(tmpdir(), "pi-agent-feedback-home-"));
    harness = await startPiRpcHarness({
      cwd: tempProject,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        extensionPath,
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "agent_feedback",
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        HOME: tempHome,
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedResponseText,
        [FAUX_TOOL_CALLS_ENV]: JSON.stringify([
          {
            id: "agent-feedback-e2e",
            name: "agent_feedback",
            arguments: {
              category: "verification_blocker",
              summary: "Could not run the Docker smoke test.",
              impact: "Deployment verification remained incomplete.",
              attempted: "Ran the documented smoke test command after unit tests passed.",
              blocker: "Docker daemon was unavailable in the local environment.",
              suggestedFix: "Document the Docker requirement or provide a no-Docker smoke target.",
            },
          },
        ]),
      },
    });

    // Act
    const promptResponse = await harness.request({ type: "prompt", message: "Use the configured feedback tool." });
    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "agent_feedback",
      60_000,
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);
    const feedbackFile = join(tempProject, "agent_feedback.md");
    const feedbackContent = await readFile(feedbackFile, "utf8");

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(toolEnd)).toContain("Saved agent feedback to agent_feedback.md");
    expect(eventText(agentEnd)).toContain(expectedResponseText);
    expect(feedbackContent).toContain("# Agent Feedback");
    expect(feedbackContent).toContain("## ");
    expect(feedbackContent).toContain("— verification_blocker");
    expect(feedbackContent).toContain("Summary: Could not run the Docker smoke test.");
    expect(feedbackContent).toContain("Blocker:\nDocker daemon was unavailable in the local environment.");
    expect(harness.stderr()).toBe("");
  }, 90_000);
});
