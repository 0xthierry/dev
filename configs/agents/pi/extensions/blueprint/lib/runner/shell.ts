import { spawn } from "node:child_process";

export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export function runShellCommand(
  command: string,
  options: { cwd: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let closed = false;
    let timedOut = false;

    const child = spawn("bash", ["-lc", command], {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    const abort = () => {
      child.kill("SIGTERM");
    };

    const finish = (exitCode: number) => {
      if (closed) return;
      closed = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      resolve({ stdout, stderr, exitCode, timedOut });
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.once("error", (error) => {
      stderr += `${error.message}\n`;
      finish(1);
    });

    child.once("close", (code) => {
      finish(code ?? 0);
    });

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}
