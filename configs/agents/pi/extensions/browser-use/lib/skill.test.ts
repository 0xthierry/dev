import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BROWSER_USE_PROMPT_GUIDELINES } from "./definitions";

const skill = readFileSync(new URL("../skills/control-browser/SKILL.md", import.meta.url), "utf8");

function section(heading: string): string {
  const start = skill.indexOf(heading);
  if (start < 0) throw new Error("Expected skill section is missing.");
  const end = skill.indexOf("\n## ", start + heading.length);
  return skill.slice(start, end < 0 ? undefined : end);
}

describe("control-browser skill contract", () => {
  test("allows the original agent-browser skill for separate managed workflows", () => {
    // Arrange
    const guidance = section("## Choose the workflow");

    // Act
    const promptGuidance = BROWSER_USE_PROMPT_GUIDELINES.join("\n");

    // Assert
    expect(guidance).toContain("unchanged `agent-browser` skill");
    expect(guidance).toContain("not a blanket ban");
    expect(guidance).toContain("Do not switch an existing-browser task");
    expect(promptGuidance).toContain("separate managed automation and QA sessions");
    expect(promptGuidance).not.toContain("while browser_use is available");
  });

  test("distinguishes user discovery, claiming, and playback evidence", () => {
    // Arrange
    const heading = "## Existing tabs and evidence";

    // Act
    const guidance = section(heading);

    // Assert
    expect(guidance).toContain("browser.user.openTabs()");
    expect(guidance).toContain("browser.tabs.list()` lists only tabs controlled");
    expect(guidance).toContain("await browser.user.claimTab(selectedTab)");
    expect(guidance).toContain("exact tab object returned");
    expect(guidance).toContain("not whether media is playing");
    expect(guidance).toContain("Before opening or claiming tabs");
    expect(guidance).toContain("browser.nameSession");
  });

  test("documents turn-scoped ownership and reset recovery", () => {
    // Arrange
    const headings = ["## Turn cleanup", "## Bootstrap"];

    // Act
    const [cleanup, bootstrap] = headings.map(section);

    // Assert
    expect(cleanup).toContain("turn-scoped");
    expect(cleanup).toContain("Claimed user tabs are released, not closed");
    expect(cleanup).toContain("mark a tab again in each turn");
    expect(bootstrap).toContain("`/reload`, an abort, or a process crash resets them");
    expect(bootstrap).toContain("After an explicit reset, bootstrap again");
    expect(bootstrap).toContain("do not reuse old bindings or recommend reinstalling");
  });

  test("keeps approvals fail-closed and explains screenshot error loss", () => {
    // Arrange
    const heading = "## Screenshots and approvals";

    // Act
    const guidance = section(heading);

    // Assert
    expect(guidance).toContain("discards buffered images when JavaScript throws");
    expect(guidance).toContain("separate successful screenshot call");
    expect(guidance).toContain("Pi's confirmation UI");
    expect(guidance).toContain("never bypass it or auto-approve");
    expect(guidance).toContain("Strict automatic review is unsupported and fails closed");
  });

  test("documents permission categories separately from action and browser-native confirmations", () => {
    // Arrange
    const heading = "## Permission categories and available APIs";

    // Act
    const guidance = section(heading);

    // Assert
    for (const category of [
      "Website/origin access",
      "Browsing history",
      "File upload",
      "File download or asset export",
      "Raw CDP access",
      "Cross-origin asset access",
      "WebMCP actions",
    ]) {
      expect(guidance).toContain(category);
    }
    expect(guidance).toContain("not Pi on/off options");
    expect(guidance).toContain("Runtime permission");
    expect(guidance).toContain("Action confirmation");
    expect(guidance).toContain("Browser-native permission");
    expect(guidance).toContain("never inspect history speculatively");
    expect(guidance).toContain("does not grant website access");
    expect(guidance).toContain("does not request persistent grants");
    expect(guidance).toContain("mandatory automated safety reviews");
    expect(guidance).toContain("read the selected capability's `documentation()`");
  });

  test("avoids redundant debugging questions without removing features or bypassing runtime permissions", () => {
    // Arrange
    const heading = "## Permission categories and available APIs";

    // Act
    const guidance = section(heading);

    // Assert
    expect(guidance).toContain("no extra conversational prompts");
    expect(guidance).toContain("read-only CDP debugging observations");
    expect(guidance).toContain("Keep CDP and recording capabilities available");
    expect(guidance).toContain("Do not ask the same permission question in chat and then again through Pi's dialog");
    expect(guidance).toContain("Do not suppress runtime CDP permission requests");
    expect(guidance).toContain("not first-party permission checks");
  });

  test("keeps platform-neutral bootstrap and explicit-family constraints", () => {
    // Arrange
    const forbiddenSnippets = [
      'get("iab")',
      "agent.browsers.getDefault()",
      'If `get("chrome")` fails, try',
      "may skip `documentation()`",
    ];

    // Act
    const forbiddenMatches = forbiddenSnippets.filter((snippet) => skill.includes(snippet));

    // Assert
    expect(forbiddenMatches).toEqual([]);
    expect(skill).toContain("absolute path from the `browser_use` tool description");
    expect(skill).toContain("Linux or macOS");
    expect(skill).not.toMatch(/\/(?:home|Users|usr)\//);
    expect(skill).toContain("An explicit browser request is a hard constraint");
    expect(skill).toContain('agent.browsers.get("extension")');
    expect(skill).toContain("Before each semantic operation");
    expect(skill).toContain("MUST emit and read the complete documentation");
  });
});
