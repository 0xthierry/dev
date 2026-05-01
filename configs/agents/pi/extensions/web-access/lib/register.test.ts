import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerWebAccessExtension } from "./register";
import { clearResults } from "./storage/result-store";

type ParameterSchema = {
  description?: string;
  enum?: string[];
};

function parameterProperties(tool: unknown): Record<string, ParameterSchema | undefined> {
  const parameters = (tool as { parameters?: unknown } | undefined)?.parameters as
    | { properties?: Record<string, ParameterSchema> }
    | undefined;
  return parameters?.properties ?? {};
}

afterEach(() => {
  clearResults();
  mock.clearAllMocks();
});

describe("registerWebAccessExtension", () => {
  test("registers user-facing web tools", () => {
    // Arrange
    const fake = createFakePi();

    // Act
    registerWebAccessExtension(fake.pi);

    // Assert
    expect([...fake.tools.keys()].sort()).toEqual(["fetch_content", "get_search_content", "web_search"]);
  });

  test("describes tool capabilities without exposing implementation details", () => {
    // Arrange
    const fake = createFakePi();
    const implementationTerms = /\b(Exa|Codex|Gemini|Brave|Chromium|yt-dlp|ffmpeg)\b/i;

    // Act
    registerWebAccessExtension(fake.pi);
    const webSearch = fake.tools.get("web_search");
    const fetchContent = fake.tools.get("fetch_content");
    const getSearchContent = fake.tools.get("get_search_content");

    // Assert
    expect(webSearch?.description).toContain("Search the web");
    expect(fetchContent?.description).toContain("Fetch one or more URLs");
    expect(getSearchContent?.description).toContain("Retrieve stored search results");
    for (const tool of [webSearch, fetchContent, getSearchContent]) {
      expect(JSON.stringify({ description: tool?.description, promptSnippet: tool?.promptSnippet })).not.toMatch(
        implementationTerms,
      );
    }
  });

  test("gives optional parameters short usage guidance and constrains content analysis models", () => {
    // Arrange
    const fake = createFakePi();

    // Act
    registerWebAccessExtension(fake.pi);
    const webSearchProperties = parameterProperties(fake.tools.get("web_search"));
    const fetchContentProperties = parameterProperties(fake.tools.get("fetch_content"));
    const getSearchContentProperties = parameterProperties(fake.tools.get("get_search_content"));

    // Assert
    for (const [name, schema] of Object.entries({
      query: webSearchProperties.query,
      queries: webSearchProperties.queries,
      numResults: webSearchProperties.numResults,
      includeContent: webSearchProperties.includeContent,
      recencyFilter: webSearchProperties.recencyFilter,
      domainFilter: webSearchProperties.domainFilter,
      url: fetchContentProperties.url,
      urls: fetchContentProperties.urls,
      forceClone: fetchContentProperties.forceClone,
      prompt: fetchContentProperties.prompt,
      timestamp: fetchContentProperties.timestamp,
      frames: fetchContentProperties.frames,
      model: fetchContentProperties.model,
      queryIndex: getSearchContentProperties.queryIndex,
      urlIndex: getSearchContentProperties.urlIndex,
      storedUrl: getSearchContentProperties.url,
    })) {
      expect(schema?.description, `${name} description`).toContain(". Use ");
    }
    expect(fetchContentProperties.model?.enum).toEqual([
      "gemini-3-flash-preview",
      "gemini-3-pro",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
  });

  test("registers session lifecycle handlers", async () => {
    // Arrange
    const fake = createFakePi();

    // Act
    registerWebAccessExtension(fake.pi);
    await fake.emit("session_shutdown");

    // Assert
    expect(fake.handlers.has("session_start")).toBe(true);
    expect(fake.handlers.has("session_tree")).toBe(true);
    expect(fake.handlers.has("session_shutdown")).toBe(true);
  });
});
