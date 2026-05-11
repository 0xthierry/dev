import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { AGENT_FEEDBACK_HEADING } from "./feedback";

export interface AppendAgentFeedbackEntryRequest {
  filePath: string;
  entry: string;
}

export async function appendAgentFeedbackEntry(request: AppendAgentFeedbackEntryRequest): Promise<void> {
  await withFileMutationQueue(request.filePath, async () => {
    await mkdir(dirname(request.filePath), { recursive: true });
    const existing = await readExistingFile(request.filePath);

    if (existing === null || existing.length === 0) {
      await writeFile(request.filePath, `${AGENT_FEEDBACK_HEADING}${request.entry}`, "utf8");
      return;
    }

    const separator = existing.endsWith("\n") ? "" : "\n\n";
    await appendFile(request.filePath, `${separator}${request.entry}`, "utf8");
  });
}

async function readExistingFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNoEntryError(error)) return null;
    throw error;
  }
}

function isNoEntryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
