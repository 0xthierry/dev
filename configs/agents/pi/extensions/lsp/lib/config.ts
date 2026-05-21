import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { COMMON_SKIP_DIRECTORIES, DEFAULT_SERVER_CONFIGS } from "./defaults";
import type { InternalLspServer, LspConfig, LspServerAdapter } from "./types";

const LANGUAGE_IDS_BY_EXTENSION: Record<string, string> = {
  ".astro": "astro",
  ".bash": "shellscript",
  ".c": "c",
  ".cc": "cpp",
  ".cjs": "javascript",
  ".cpp": "cpp",
  ".css": "css",
  ".cts": "typescript",
  ".cxx": "cpp",
  ".dockerfile": "dockerfile",
  ".go": "go",
  ".h": "c",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".htm": "html",
  ".html": "html",
  ".hxx": "cpp",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".jsx": "javascriptreact",
  ".less": "less",
  ".lua": "lua",
  ".markdown": "markdown",
  ".md": "markdown",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shellscript",
  ".svelte": "svelte",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".vue": "vue",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "shellscript",
};

const LANGUAGE_IDS_BY_FILE_NAME: Record<string, string> = {
  Containerfile: "dockerfile",
  Dockerfile: "dockerfile",
  ".bash_profile": "shellscript",
  ".bashrc": "shellscript",
  ".zshenv": "shellscript",
  ".zshrc": "shellscript",
};

export function loadRuntime(
  cwd = process.cwd(),
  agentDir = getAgentDir(),
): { adapters: LspServerAdapter[]; timeoutMs: number } {
  const config = loadConfig(cwd, agentDir);
  return {
    adapters: config.servers.map(configToAdapter),
    timeoutMs: config.timeout ?? 20_000,
  };
}

export function loadConfig(cwd = process.cwd(), agentDir = getAgentDir()): LspConfig {
  const configured = loadConfiguredConfig(cwd, agentDir);
  return configured ?? { servers: DEFAULT_SERVER_CONFIGS };
}

export function parseConfigSource(source: string, cwd: string, label: string): LspConfig {
  if (source.trim().startsWith("{")) return normalizeConfig(JSON.parse(source), label);
  const expandedSource = expandHome(source.trim());
  const filePath = path.isAbsolute(expandedSource) ? expandedSource : path.resolve(cwd, expandedSource);
  return parseConfigFile(filePath);
}

export function normalizeConfig(value: unknown, label: string): LspConfig {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object mapping server names to LSP server config.`);
  }

  if ("servers" in value) {
    if (isServerEntry(value.servers)) {
      throw new Error(
        `${label} uses reserved top-level key 'servers'. Use the wrapper shape ` +
          `{ "servers": { "<name>": { "command": [...], "extensions": [...] } } }` +
          " or choose a different server name.",
      );
    }
    const timeout = normalizeTimeout(value.timeout, label);
    const servers = value.servers;
    if (!isRecord(servers) || Array.isArray(servers)) {
      throw new Error(`${label}.servers must be a JSON object mapping server names to LSP server config.`);
    }
    return { timeout, servers: normalizeServerMap(servers, `${label}.servers`) };
  }

  if ("timeout" in value) {
    throw new Error(`${label}.timeout requires the wrapper shape with a servers object.`);
  }

  return { servers: normalizeServerMap(value, label) };
}

export function configToAdapter(config: InternalLspServer): LspServerAdapter {
  const extensionSet = new Set(config.extensions.map(normalizeExtension));
  const fileNameSet = new Set(config.fileNames);
  const [command, ...args] = config.command;
  if (!command) throw new Error(`${config.name}.command must contain at least one string.`);

  return {
    name: config.name,
    defaultCommand: { command, args },
    commandEnvVar: envName(config.name, "COMMAND"),
    missingCommandHint: `Install ${config.name} or set ${envName(config.name, "COMMAND")}.`,
    extensions: config.extensions,
    fileNames: config.fileNames,
    env: config.env,
    initialization: config.initialization,
    skipDirectories: COMMON_SKIP_DIRECTORIES,
    isSupportedFile: (filePath) => extensionSet.has(path.extname(filePath)) || fileNameSet.has(path.basename(filePath)),
    languageIdFor,
  };
}

function loadConfiguredConfig(cwd: string, agentDir: string): LspConfig | undefined {
  const rawConfig = process.env.PI_LSP_CONFIG?.trim();
  if (rawConfig) return parseConfigSource(rawConfig, cwd, "PI_LSP_CONFIG");

  const projectConfig = path.join(cwd, ".pi", "lsp.json");
  if (existsSync(projectConfig)) return parseConfigFile(projectConfig);

  const userConfig = path.join(agentDir, "lsp.json");
  if (existsSync(userConfig)) return parseConfigFile(userConfig);

  return undefined;
}

function parseConfigFile(filePath: string): LspConfig {
  return normalizeConfig(JSON.parse(readFileSync(filePath, "utf8")), filePath);
}

function normalizeServerMap(value: Record<string, unknown>, label: string): InternalLspServer[] {
  return Object.entries(value).map(([name, server]) => normalizeServer(name, server, `${label}.${name}`));
}

function normalizeServer(name: string, value: unknown, label: string): InternalLspServer {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const command = requiredStringArrayField(value, "command", label);
  const extensions = optionalStringArrayField(value, "extensions", label).map(normalizeExtension);
  const fileNames = optionalStringArrayField(value, "fileNames", label);
  if (extensions.length === 0 && fileNames.length === 0) {
    throw new Error(`${label} must define at least one extension or fileName.`);
  }
  return {
    name,
    command,
    extensions,
    fileNames,
    env: optionalStringRecordField(value, "env", label),
    initialization: optionalRecordField(value, "initialization", label),
  };
}

function isServerEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    (Array.isArray(value.command) || Array.isArray(value.extensions) || Array.isArray(value.fileNames))
  );
}

function normalizeTimeout(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}.timeout must be a positive number.`);
  }
  return value;
}

function requiredStringArrayField(value: Record<string, unknown>, field: string, label: string): string[] {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || !fieldValue.every((item) => typeof item === "string")) {
    throw new Error(`${label}.${field} must be an array of strings.`);
  }
  return fieldValue;
}

function optionalStringArrayField(value: Record<string, unknown>, field: string, label: string): string[] {
  const fieldValue = value[field];
  if (fieldValue === undefined) return [];
  if (!Array.isArray(fieldValue) || !fieldValue.every((item) => typeof item === "string")) {
    throw new Error(`${label}.${field} must be an array of strings.`);
  }
  return fieldValue;
}

function optionalStringRecordField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): Record<string, string> | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined) return undefined;
  if (!isRecord(fieldValue) || Array.isArray(fieldValue)) {
    throw new Error(`${label}.${field} must be an object with string values.`);
  }
  if (!Object.values(fieldValue).every((item) => typeof item === "string")) {
    throw new Error(`${label}.${field} must be an object with string values.`);
  }
  return fieldValue as Record<string, string>;
}

function optionalRecordField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): Record<string, unknown> | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined) return undefined;
  if (!isRecord(fieldValue) || Array.isArray(fieldValue)) {
    throw new Error(`${label}.${field} must be an object.`);
  }
  return fieldValue;
}

function languageIdFor(filePath: string): string {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath);
  return LANGUAGE_IDS_BY_FILE_NAME[fileName] ?? LANGUAGE_IDS_BY_EXTENSION[extension] ?? extension.slice(1);
}

function commandFromEnvName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function envName(name: string, suffix: "COMMAND"): string {
  return `PI_${commandFromEnvName(name)}_LSP_${suffix}`;
}

function normalizeExtension(extension: string): string {
  return extension.startsWith(".") ? extension : `.${extension}`;
}

function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
