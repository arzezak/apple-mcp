import { execFile } from "node:child_process";
import { textResult } from "./results.ts";

export function runAppleScript(
  script: string,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", script],
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          reject(new Error(`AppleScript error: ${msg}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

// Whose-filter scans measured past the default 30s: an all-calendars 7-day
// event query took 43s warm across ten calendars (2026-09-14).
export const SLOW_QUERY_TIMEOUT_MS = 60_000;

export async function runAndConfirm(script: string, message: string) {
  await runAppleScript(script);
  return textResult(message);
}

export async function runAndReport(
  script: string,
  emptyMessage: string,
  timeoutMs?: number,
) {
  const raw = await runAppleScript(script, timeoutMs);
  return textResult(raw || emptyMessage);
}

export function scopeExpression(kind: string, name?: string): string {
  return name ? `{${kind} ${quoted(name)}}` : `every ${kind}`;
}

export function parseList(raw: string): string[] {
  if (!raw || raw === "missing value") return [];
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// osascript's default ", " list rendering is ambiguous when an item contains
// a comma-space; parseList splits on linefeed.
export function joinLinefeedScript(varName: string): string {
  return `set AppleScript's text item delimiters to linefeed
${varName} as text`;
}

export function nameListScript(application: string, listExpression: string): string {
  return `tell application "${application}" to set resultList to ${listExpression}
${joinLinefeedScript("resultList")}`;
}

export async function runNameList(
  application: string,
  listExpression: string,
  timeoutMs?: number,
): Promise<string[]> {
  return parseList(
    await runAppleScript(
      nameListScript(application, listExpression),
      timeoutMs,
    ),
  );
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
  if (!match) return `date ${quoted(input)}`;

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

const TIME_COMPONENT_RE =
  /(?:[ T]\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b)/i;

export function hasTimeComponent(input: string): boolean {
  return TIME_COMPONENT_RE.test(input);
}

export function quoted(s: string): string {
  return `"${esc(s)}"`;
}

export function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
