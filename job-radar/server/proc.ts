import { execFile } from "node:child_process";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a command asynchronously (never blocks the API), with a timeout. */
export function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() }): Promise<ProcResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...opts.env, FORCE_COLOR: "0", NO_COLOR: "1" } },
      (err, stdout, stderr) => {
        const raw = err ? (err as unknown as { code?: number | string }).code : 0;
        resolve({ code: typeof raw === "number" ? raw : err ? 1 : 0, stdout: String(stdout), stderr: String(stderr || (err && !stdout ? err.message : "")) });
      },
    );
  });
}

/** Parses a script's JSON stdout, tolerating banner lines before/after the document. */
export function parseJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    for (const [open, close] of [["{", "}"], ["[", "]"]]) {
      const a = t.indexOf(open);
      const b = t.lastIndexOf(close);
      if (a >= 0 && b > a) {
        try {
          return JSON.parse(t.slice(a, b + 1));
        } catch {
          /* try next */
        }
      }
    }
    return null;
  }
}
