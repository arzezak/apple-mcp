import { execFile } from "node:child_process";

export type ScriptLanguage = "AppleScript" | "JavaScript";

export type RunOptions = { timeoutMs?: number; language?: ScriptLanguage };

export type RunScript = (script: string, options?: RunOptions) => Promise<string>;

export function runAppleScript(
  script: string,
  { timeoutMs = 30_000, language = "AppleScript" }: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", language, "-e", script],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          const message = error.killed
            ? `timed out after ${timeoutMs / 1000}s`
            : stderr?.trim() || error.message;

          reject(new Error(`AppleScript error: ${message}`));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

export const SLOW_QUERY_TIMEOUT_MS = 60_000;

export function quoted(text: string): string {
  return `"${escaped(text)}"`;
}

function escaped(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
