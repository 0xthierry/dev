export const REDACTED_VALUE = "[REDACTED]";

export type RedactText = (value: string) => string;

const SENSITIVE_ENV_NAME = /(?:api[_-]?key|token|secret|password|passwd|authorization|auth|credential|cookie|header)/i;

/**
 * Builds a deterministic literal redactor for inherited credentials and explicit
 * process-control capabilities. Provider authentication remains available to the
 * child; only extension-owned diagnostics and persisted/model-visible sinks are scrubbed.
 * Every nonempty value positively classified as sensitive is scrubbed exactly,
 * including short and common credentials. Names are never treated as secrets merely
 * because they are sensitive labels. Unknown and transformed values remain out of scope.
 */
export function createEnvironmentRedactor(
  environment: NodeJS.ProcessEnv,
  explicitSensitiveValues: readonly string[] = [],
): RedactText {
  const inherited = Object.entries(environment)
    .filter(([name]) => SENSITIVE_ENV_NAME.test(name))
    .flatMap(([, value]) => (value ? [value] : []));
  const explicit = explicitSensitiveValues.filter((value) => value.length > 0);
  const literals = [...new Set([...inherited, ...explicit])].sort((left, right) =>
    right.length === left.length ? left.localeCompare(right) : right.length - left.length,
  );
  if (!literals.length) return (value) => value;
  const exactValues = new RegExp(literals.map(escapeRegularExpression).join("|"), "gu");
  return (value) =>
    value
      .split(REDACTED_VALUE)
      .map((segment) => segment.replace(exactValues, REDACTED_VALUE))
      .join(REDACTED_VALUE);
}

export function redactStringValues<T>(value: T, redact: RedactText): T {
  return redactValue(value, redact, new WeakMap()) as T;
}

function redactValue(value: unknown, redact: RedactText, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redactValue(item, redact, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = redactValue(item, redact, seen);
  return copy;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
