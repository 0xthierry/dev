import { createWorkflowRunArtifacts } from "../runner/artifacts";
import { runWorkflowChildPiAgent } from "../runner/child-pi";
import type { DynamicWorkflowRuntime } from "./types";

export function createDynamicWorkflowRuntime(): DynamicWorkflowRuntime {
  return {
    createRunArtifacts: (request) => createWorkflowRunArtifacts(request),
    runAgent: runWorkflowChildPiAgent,
  };
}
