import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { storeResult } from "../storage/result-store";
import type { StoredSearchData } from "../types";
import { CUSTOM_ENTRY_TYPE } from "./definitions";

export function storeAndPublish(pi: ExtensionAPI, data: StoredSearchData): void {
  storeResult(data.id, data);
  pi.appendEntry(CUSTOM_ENTRY_TYPE, data);
}
