import { execFile } from "node:child_process";

export function readExecError(err: unknown): { code?: string | number; stderr: string; message: string } {
  if (!err || typeof err !== "object") return { stderr: "", message: String(err) };
  const value = err as { code?: string | number; stderr?: unknown; message?: unknown };
  return {
    code: value.code,
    stderr: typeof value.stderr === "string" || Buffer.isBuffer(value.stderr) ? String(value.stderr) : "",
    message: typeof value.message === "string" ? value.message : String(err),
  };
}

export function trimErrorText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

export function isTimeoutError(err: unknown): boolean {
  const { message, stderr } = readExecError(err);
  return /timed out|timeout|SIGTERM/i.test(`${message}\n${stderr}`);
}

function abortError(): Error {
  return new Error("Aborted");
}

export function execFileText(
  command: string,
  args: string[],
  options: { timeout?: number; signal?: AbortSignal; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = execFile(command, args, { timeout: options.timeout, cwd: options.cwd }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end();
    if (options.signal) {
      const onAbort = () => {
        child.kill();
        reject(abortError());
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      child.on("exit", () => options.signal?.removeEventListener("abort", onAbort));
    }
  });
}

export function execFileBuffer(
  command: string,
  args: string[],
  options: { maxBuffer?: number; timeout?: number; signal?: AbortSignal; cwd?: string } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = execFile(
      command,
      args,
      { maxBuffer: options.maxBuffer, timeout: options.timeout, cwd: options.cwd },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else
          resolve({ stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout)), stderr: String(stderr) });
      },
    );
    child.stdin?.end();
    if (options.signal) {
      const onAbort = () => {
        child.kill();
        reject(abortError());
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      child.on("exit", () => options.signal?.removeEventListener("abort", onAbort));
    }
  });
}
