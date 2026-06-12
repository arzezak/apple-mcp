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
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Build a script that returns an AppleScript list joined by linefeed rather than
// letting osascript render it with ", " (which is ambiguous: an item may itself
// contain a comma-space). parseList splits the result back on linefeed.
export function nameListScript(
  application: string,
  listExpression: string,
): string {
  return `tell application "${application}" to set resultList to ${listExpression}
set AppleScript's text item delimiters to linefeed
resultList as text`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isValidDateParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function appleScriptTime(hour: number, minute: number, second: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")} ${suffix}`;
}

export function appleScriptDateLiteral(input: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      input,
    );
  if (!match) return `date "${esc(input)}"`;

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = hourRaw === undefined ? 0 : Number(hourRaw);
  const minute = minuteRaw === undefined ? 0 : Number(minuteRaw);
  const second = secondRaw === undefined ? 0 : Number(secondRaw);

  if (!isValidDateParts(year, month, day, hour, minute, second)) {
    throw new Error(`Invalid ISO date: ${input}`);
  }

  return `date "${day} ${MONTH_NAMES[month - 1]} ${year} at ${appleScriptTime(hour, minute, second)}"`;
}

export function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
