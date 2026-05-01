import { execFileText } from "../shared/process";
import { extractMarkdownUrls } from "../shared/text";
import type { ExtractedContent, SearchOptions, SearchResponse } from "../types";

export interface CodexOptions {
  timeoutMs?: number;
  cwd?: string;
}

function domainInstructions(domainFilter: string[] | undefined): string {
  if (!domainFilter?.length) return "";
  const includes = domainFilter.filter((domain) => !domain.startsWith("-"));
  const excludes = domainFilter.filter((domain) => domain.startsWith("-")).map((domain) => domain.slice(1));
  const parts: string[] = [];
  if (includes.length > 0) parts.push(`Only use sources from these domains: ${includes.join(", ")}.`);
  if (excludes.length > 0) parts.push(`Do not use sources from these domains: ${excludes.join(", ")}.`);
  return parts.join("\n");
}

function recencyInstruction(recencyFilter: SearchOptions["recencyFilter"]): string {
  if (!recencyFilter) return "";
  const labels = { day: "past 24 hours", week: "past week", month: "past month", year: "past year" } as const;
  return `Prefer sources from the ${labels[recencyFilter]}.`;
}

export function codexArgs(prompt: string, cwd: string): string[] {
  return [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-C",
    cwd,
    prompt,
  ];
}

async function runCodex(prompt: string, options: CodexOptions & { signal?: AbortSignal } = {}): Promise<string> {
  const { stdout } = await execFileText("codex", codexArgs(prompt, options.cwd ?? process.cwd()), {
    timeout: options.timeoutMs ?? 120_000,
    signal: options.signal,
  });
  return stdout.trim();
}

export function buildCodexSearchPrompt(query: string, options: SearchOptions = {}): string {
  return [
    "Use your native web search tool to answer this query with current sources.",
    "Return concise markdown with a short answer and a Sources section containing source URLs.",
    `Limit to about ${Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20)} sources.`,
    recencyInstruction(options.recencyFilter),
    domainInstructions(options.domainFilter),
    "",
    `Query: ${query}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCodexFetchPrompt(url: string, prompt: string | undefined): string {
  return [
    "Use your web.open/fetch capability to open the URL below and extract readable content as markdown.",
    "Do not summarize unless the user prompt asks for a summary. Preserve headings, code blocks, links, and source URL.",
    prompt ? `User prompt: ${prompt}` : undefined,
    "",
    `URL: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function searchWithCodex(
  query: string,
  options: SearchOptions & CodexOptions = {},
): Promise<SearchResponse> {
  const prompt = buildCodexSearchPrompt(query, options);

  const answer = await runCodex(prompt, options);
  const urls = extractMarkdownUrls(answer);
  return {
    answer,
    provider: "codex",
    results: urls.slice(0, options.numResults ?? 5).map((url, index) => ({
      title: `Codex source ${index + 1}`,
      url,
      snippet: "",
    })),
  };
}

export async function fetchWithCodex(
  url: string,
  prompt: string | undefined,
  options: CodexOptions & { signal?: AbortSignal } = {},
): Promise<ExtractedContent | null> {
  const content = await runCodex(buildCodexFetchPrompt(url, prompt), options);
  if (content.length < 20) return null;
  return {
    url,
    title: extractTitle(content, url),
    content,
    error: null,
    provider: "codex",
  };
}

function extractTitle(markdown: string, url: string): string {
  const heading = markdown.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/\*+/g, "");
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
