import type { InternalLspServer } from "./types";

export const COMMON_SKIP_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".output",
  ".ruff_cache",
  ".svelte-kit",
  ".tox",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

export const DEFAULT_SERVER_CONFIGS: InternalLspServer[] = [
  {
    name: "typescript",
    command: ["typescript-language-server", "--stdio"],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts", ".cjs", ".cts"],
    fileNames: [],
  },
  {
    name: "json",
    command: ["vscode-json-language-server", "--stdio"],
    extensions: [".json", ".jsonc"],
    fileNames: [],
  },
  {
    name: "html",
    command: ["vscode-html-language-server", "--stdio"],
    extensions: [".html", ".htm"],
    fileNames: [],
  },
  {
    name: "css",
    command: ["vscode-css-language-server", "--stdio"],
    extensions: [".css", ".scss", ".less"],
    fileNames: [],
  },
  {
    name: "rust",
    command: ["rust-analyzer"],
    extensions: [".rs"],
    fileNames: [],
  },
  {
    name: "go",
    command: ["gopls"],
    extensions: [".go"],
    fileNames: [],
  },
  {
    name: "pyright",
    command: ["pyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"],
    fileNames: [],
  },
  {
    name: "bash",
    command: ["bash-language-server", "start"],
    extensions: [".sh", ".bash", ".zsh"],
    fileNames: [".bashrc", ".bash_profile", ".zshrc", ".zshenv"],
  },
  {
    name: "yaml",
    command: ["yaml-language-server", "--stdio"],
    extensions: [".yaml", ".yml"],
    fileNames: [],
  },
  {
    name: "taplo",
    command: ["taplo", "lsp", "stdio"],
    extensions: [".toml"],
    fileNames: [],
  },
  {
    name: "lua",
    command: ["lua-language-server"],
    extensions: [".lua"],
    fileNames: [],
  },
  {
    name: "clangd",
    command: ["clangd"],
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"],
    fileNames: [],
  },
  {
    name: "tailwindcss",
    command: ["tailwindcss-language-server", "--stdio"],
    extensions: [".astro", ".css", ".html", ".js", ".jsx", ".svelte", ".ts", ".tsx", ".vue"],
    fileNames: [],
  },
  {
    name: "dockerfile",
    command: ["docker-langserver", "--stdio"],
    extensions: [".dockerfile"],
    fileNames: ["Dockerfile", "Containerfile"],
  },
  {
    name: "marksman",
    command: ["marksman", "server"],
    extensions: [".md", ".markdown"],
    fileNames: [],
  },
];
