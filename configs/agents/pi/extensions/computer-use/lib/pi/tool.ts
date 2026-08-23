import { z } from "zod";

const codeInputSchema = z.object({ code: z.string() });

export function parseComputerUseCode(value: unknown): string {
  return codeInputSchema.parse(value).code;
}

export function summarizeComputerUseCode(value: unknown): string | undefined {
  const parsed = codeInputSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data.code
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 100);
}
