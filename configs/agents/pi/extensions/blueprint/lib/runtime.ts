import { discoverBlueprints } from "./discovery";
import { type BlueprintRunRequest, runBlueprint } from "./runner/execute";
import type { BlueprintDiscoveryResult, BlueprintRunProgress, BlueprintRunResult } from "./types";

export interface BlueprintRuntime {
  discoverBlueprints: (cwd: string) => Promise<BlueprintDiscoveryResult>;
  runBlueprint: (
    request: BlueprintRunRequest,
    onProgress?: (progress: BlueprintRunProgress) => void,
  ) => Promise<BlueprintRunResult>;
}

export function createBlueprintRuntime(): BlueprintRuntime {
  return {
    discoverBlueprints,
    runBlueprint,
  };
}
