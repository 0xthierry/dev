import { fetchAllContent } from "../content/pipeline";
import { search } from "../search/orchestrator";
import { generateId } from "../storage/result-store";

export interface WebAccessRuntime {
  search: typeof search;
  fetchAllContent: typeof fetchAllContent;
  generateId: typeof generateId;
}

export function createWebAccessRuntime(): WebAccessRuntime {
  return {
    search,
    fetchAllContent,
    generateId,
  };
}
