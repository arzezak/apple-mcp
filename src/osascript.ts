import { execFile } from "node:child_process";

/**
 * Run an AppleScript string via osascript and return stdout.
 * Throws on non-zero exit or stderr output.
 */
export function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        reject(new Error(`AppleScript error: ${msg}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Run a multi-line AppleScript (passed as separate -e arguments per line).
 * osascript treats each -e as a line of the same script.
 */
export function runAppleScriptMultiline(script: string): Promise<string> {
  const args: string[] = [];
  for (const line of script.split("\n")) {
    args.push("-e", line);
  }
  return new Promise((resolve, reject) => {
    execFile("osascript", args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        reject(new Error(`AppleScript error: ${msg}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Parse AppleScript list output like "item1, item2, item3" into an array.
 */
export function parseList(raw: string): string[] {
  if (!raw || raw === "missing value") return [];
  return raw.split(", ").map((s) => s.trim()).filter(Boolean);
}
