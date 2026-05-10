import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedBlueprint } from "../types";

export interface InitialContextOptions {
  runCommand?: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export async function buildInitialBlueprintContext(
  blueprint: LoadedBlueprint,
  cwd: string,
  task: string,
  options: InitialContextOptions = {},
): Promise<string> {
  const runCommand = options.runCommand ?? (async () => ({ stdout: "", stderr: "", exitCode: 1 }));
  const [gitStatus, packageScripts] = await Promise.all([readGitStatus(runCommand), readPackageScripts(cwd)]);

  return [
    "# Blueprint Context",
    "",
    `Blueprint: ${blueprint.id}`,
    blueprint.description ? `Description: ${blueprint.description}` : "Description: (none)",
    `Working directory: ${cwd}`,
    "",
    "## User Task",
    task,
    "",
    "## Git Status",
    gitStatus || "(git status unavailable or clean)",
    "",
    "## Package Scripts",
    packageScripts || "(no package.json scripts found)",
    "",
  ].join("\n");
}

async function readGitStatus(
  runCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<string> {
  const result = await runCommand("git status --short");
  if (result.exitCode !== 0) return result.stderr.trim();
  return result.stdout.trim();
}

async function readPackageScripts(cwd: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(join(cwd, "package.json"), "utf8");
  } catch {
    return "";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "";
  }

  if (!parsed || typeof parsed !== "object") return "";
  const scripts = (parsed as Record<string, unknown>).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return "";

  return Object.entries(scripts as Record<string, unknown>)
    .filter(([, command]) => typeof command === "string")
    .map(([name, command]) => `- ${name}: ${command}`)
    .join("\n");
}
