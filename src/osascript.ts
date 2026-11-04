import { execFile } from "node:child_process";

export type RunScript = (script: string, timeoutMs?: number) => Promise<string>;

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
          const msg = err.killed
            ? `timed out after ${timeoutMs / 1000}s`
            : stderr?.trim() || err.message;
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

export function matchClause({
  nameProperty,
  name,
  id,
  idProperty = "id",
}: {
  nameProperty: string;
  name?: string;
  id?: string;
  idProperty?: string;
}): { clause: string; label: string } {
  if ((name === undefined) === (id === undefined)) {
    throw new Error("Provide exactly one of name or id.");
  }
  return {
    clause:
      id !== undefined
        ? `${idProperty} is ${quoted(id)}`
        : `${nameProperty} is ${quoted(name!)}`,
    label: matchLabel({ name, id }),
  };
}

export function matchLabel({ name, id }: { name?: string; id?: string }): string {
  return id !== undefined ? `with id ${id}` : quoted(name!);
}

// Checked with a count rather than by binding the match first: binding a
// reference to a reminder created seconds earlier blocks ~6-13s (2026-11-04).
export function deleteFirstMatching(kind: string, clause: string): string {
  return `if (count of (every ${kind} whose ${clause})) is 0 then error "No matching ${kind}." number 1
  delete (first ${kind} whose ${clause})`;
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
  run: RunScript,
  application: string,
  listExpression: string,
  timeoutMs?: number,
): Promise<string[]> {
  return parseList(
    await run(nameListScript(application, listExpression), timeoutMs),
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

export function appleScriptDateLiteral(input: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      input,
    );
  if (!match) return `date ${quoted(input)}`;

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== iso) {
    throw new Error(`Invalid ISO date: ${input}`);
  }

  const h = Number(hour);
  const time = `${h % 12 || 12}:${minute}:${second} ${h >= 12 ? "PM" : "AM"}`;
  return `date "${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year} at ${time}"`;
}

const TIME_COMPONENT_RE =
  /(?:[ T]\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b)/i;

export function hasTimeComponent(input: string): boolean {
  return TIME_COMPONENT_RE.test(input);
}

export function quoted(s: string): string {
  return `"${esc(s)}"`;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
