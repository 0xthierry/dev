import { discoverProjectRules } from "./discovery";
import type { RuleDiscoveryResult } from "./types";

export type ProjectRulesRuntime = {
  discover: (cwd: string) => Promise<RuleDiscoveryResult>;
};

export function createProjectRulesRuntime(): ProjectRulesRuntime {
  return {
    discover: discoverProjectRules,
  };
}
