import { quoted, type RunOptions, type RunScript } from "./osascript.ts";

export function scopeExpression(kind: string, name?: string): string {
  return name ? `{${kind} ${quoted(name)}}` : `every ${kind}`;
}

export function parseList(raw: string): string[] {
  if (!raw || raw === "missing value") return [];

  return raw
    .split("\n")
    .map((line) => line.trim())
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
  options?: RunOptions,
): Promise<string[]> {
  return parseList(await run(nameListScript(application, listExpression), options));
}

export function singleLine(text: string): string {
  return text
    .split(/\s*[\r\n]+\s*/)
    .filter(Boolean)
    .join(" / ");
}
