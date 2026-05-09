import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { GitHubUrlInfo } from "./url";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp4",
  ".mov",
  ".avi",
  ".sqlite",
  ".db",
]);
const NOISE_DIRS = new Set(["node_modules", "vendor", ".next", "dist", "build", "target", ".git", ".venv", "venv"]);
const MAX_TREE_ENTRIES = 200;
const MAX_INLINE_FILE_CHARS = 100_000;

function resolveWithinRepo(rootPath: string, relativePath: string): string | null {
  const root = resolve(rootPath);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  if (!existsSync(candidate)) return candidate;
  try {
    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    return realCandidate === realRoot || realCandidate.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function buildTree(rootPath: string): string {
  const entries: string[] = [];
  function walk(dir: string, relPath: string): void {
    if (entries.length >= MAX_TREE_ENTRIES) return;
    let items: string[];
    try {
      items = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const item of items) {
      if (entries.length >= MAX_TREE_ENTRIES) return;
      const rel = relPath ? `${relPath}/${item}` : item;
      const fullPath = resolveWithinRepo(rootPath, rel);
      if (!fullPath) continue;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (NOISE_DIRS.has(item)) {
          entries.push(`${rel}/ [skipped]`);
          continue;
        }
        entries.push(`${rel}/`);
        walk(fullPath, rel);
      } else {
        entries.push(rel);
      }
    }
  }
  walk(rootPath, "");
  if (entries.length >= MAX_TREE_ENTRIES) entries.push(`... (truncated at ${MAX_TREE_ENTRIES} entries)`);
  return entries.join("\n");
}

function readReadme(localPath: string): string | null {
  for (const name of ["README.md", "readme.md", "README", "README.txt"]) {
    const path = join(localPath, name);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf-8");
    return content.length > 8192 ? `${content.slice(0, 8192)}\n\n[README truncated at 8K chars]` : content;
  }
  return null;
}

export function buildGitHubContent(localPath: string, info: GitHubUrlInfo): string {
  const lines: string[] = [];
  if (info.type === "blob" && info.path) {
    const filePath = resolveWithinRepo(localPath, info.path);
    if (
      filePath &&
      existsSync(filePath) &&
      statSync(filePath).isFile() &&
      !BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())
    ) {
      const content = readFileSync(filePath, "utf-8");
      lines.push(`## ${info.path}`);
      lines.push(
        content.length > MAX_INLINE_FILE_CHARS
          ? `${content.slice(0, MAX_INLINE_FILE_CHARS)}\n\n[File truncated at 100K chars]`
          : content,
      );
      appendLocalCheckout(lines, localPath);
      return lines.join("\n");
    }
  }
  if (info.type === "tree" && info.path) {
    const dirPath = resolveWithinRepo(localPath, info.path);
    if (dirPath && existsSync(dirPath) && statSync(dirPath).isDirectory()) {
      lines.push(`## ${info.path}`);
      lines.push(readdirSync(dirPath).sort().slice(0, MAX_TREE_ENTRIES).join("\n"));
      appendLocalCheckout(lines, localPath);
      return lines.join("\n");
    }
  }
  lines.push("## Structure");
  lines.push(buildTree(localPath));
  const readme = readReadme(localPath);
  if (readme) lines.push("", "## README", readme);
  appendLocalCheckout(lines, localPath);
  return lines.join("\n");
}

function appendLocalCheckout(lines: string[], localPath: string): void {
  lines.push(
    "",
    "## Local checkout",
    `Repository cloned to: ${localPath}`,
    "Use read and bash tools at the cloned path to explore further.",
  );
}
