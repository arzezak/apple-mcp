import { execFile } from "node:child_process";

function execOsascript(args: string[]): Promise<string> {
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

export function runAppleScript(script: string): Promise<string> {
  const args: string[] = [];
  for (const line of script.split("\n")) {
    args.push("-e", line);
  }
  return execOsascript(args);
}

export function parseList(raw: string): string[] {
  if (!raw || raw === "missing value") return [];
  return raw
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
