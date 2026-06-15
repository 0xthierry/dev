import type {
  FileFinderApi,
  GrepCursor,
  GrepMode,
  GrepOptions,
  GrepResult,
  HealthCheck,
  MixedItem,
  MultiGrepOptions,
  Result,
  ScanProgress,
  SearchOptions,
  SearchResult,
} from "@ff-labs/fff-node";

export type {
  FileFinderApi,
  GrepCursor,
  GrepMode,
  GrepOptions,
  GrepResult,
  HealthCheck,
  MixedItem,
  MultiGrepOptions,
  Result,
  ScanProgress,
  SearchOptions,
  SearchResult,
};

export type FffFinder = FileFinderApi;

export type FffRuntime = {
  ensureFinder(cwd: string): Promise<FffFinder>;
  getFinder(): FffFinder | null;
  destroy(): void;
};

export type NoticeLevel = "info" | "warning" | "error";
