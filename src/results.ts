export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

export function linesResult(lines: string[], emptyMessage: string) {
  return textResult(lines.length ? lines.join("\n") : emptyMessage);
}
