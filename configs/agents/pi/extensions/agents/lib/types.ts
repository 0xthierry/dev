export type AgentsContextFile = {
  key: string;
  path: string;
  relativePath: string;
  filename: string;
  content: string;
};

export type AgentsSession = {
  projectRoot: string;
  nativeFiles: AgentsContextFile[];
  diagnostics: string[];
};

export type AgentsContextDiscovery = {
  files: AgentsContextFile[];
  diagnostics: string[];
};

export type AgentsPathTargetKind = "file" | "directory" | "unknown";

export type AgentsPathTarget = {
  path: string;
  kind: AgentsPathTargetKind;
};
