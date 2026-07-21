export interface AmqMonitorMessage {
  id: string;
  from?: string;
  to?: string[];
  thread?: string;
  subject?: string;
  priority?: string;
  kind?: string;
  created?: string;
  body?: string;
}

interface MonitorCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface AmqMonitorJson {
  event?: string;
  count?: number;
  drained?: unknown[];
}

type ParsedMonitorPayload =
  | { kind: "empty" }
  | { kind: "messages"; ids: string[]; text: string }
  | { kind: "invalid"; reason: string };

type MonitorPayload =
  | { kind: "empty" }
  | { kind: "messages"; ids: string[]; text: string }
  | { kind: "failure"; reason: string };

export function parseMonitorResult(result: MonitorCommandResult, me: string): MonitorPayload {
  const payload = parseMonitorPayload(result.stdout, me);
  if (payload.kind === "messages") return payload;

  if (result.code !== 0 && result.code !== 4) {
    return {
      kind: "failure",
      reason: result.stderr.trim() || `amq monitor exited with code ${result.code}`,
    };
  }

  if (payload.kind === "invalid") return { kind: "failure", reason: payload.reason };
  return payload;
}

function parseMonitorPayload(stdout: string, me: string): ParsedMonitorPayload {
  const trimmed = stdout.trim();
  if (trimmed === "") return { kind: "empty" };

  let parsed: AmqMonitorJson;
  try {
    parsed = JSON.parse(trimmed) as AmqMonitorJson;
  } catch (error) {
    return { kind: "invalid", reason: `invalid JSON from amq monitor: ${String(error)}` };
  }

  const expectedCount = parsed.count ?? 0;
  const messages = parseMessages(parsed.drained);
  if (expectedCount === 0 && messages.length === 0) return { kind: "empty" };
  if (messages.length === 0) return { kind: "invalid", reason: "amq monitor reported messages without parseable ids" };

  return {
    kind: "messages",
    ids: messages.map((message) => message.id),
    text: formatMonitorMessages(messages, me),
  };
}

function parseMessages(value: unknown[] | undefined): AmqMonitorMessage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string" || candidate.id.trim() === "") return [];

    return [
      {
        id: candidate.id,
        from: stringValue(candidate.from),
        to: stringArrayValue(candidate.to),
        thread: stringValue(candidate.thread),
        subject: stringValue(candidate.subject),
        priority: stringValue(candidate.priority),
        kind: stringValue(candidate.kind),
        created: stringValue(candidate.created),
        body: stringValue(candidate.body),
      },
    ];
  });
}

function formatMonitorMessages(messages: AmqMonitorMessage[], me: string): string {
  const countLabel = messages.length === 1 ? "message" : "messages";
  const sections = messages.map((message) => formatMonitorMessage(message));

  return [`[AMQ] ${messages.length} ${countLabel} available for ${me}:`, "", ...sections].join("\n").trimEnd();
}

function formatMonitorMessage(message: AmqMonitorMessage): string {
  const lines = [
    `- From: ${message.from ?? "unknown"}`,
    `  ID: ${message.id}`,
    `  Subject: ${message.subject || "-"}`,
    `  Priority: ${message.priority || "-"}`,
    `  Kind: ${message.kind || "-"}`,
    `  Thread: ${message.thread || "-"}`,
  ];

  const body = message.body?.trimEnd();
  if (body) {
    lines.push("  Body:", body, "---");
  }

  return lines.join("\n");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}
