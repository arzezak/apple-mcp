export const MARKDOWN_SYNTAX_DESCRIPTION =
  "Supports markdown: # headings, - bullets, 1. numbered, **bold**, *italic*, ```code blocks```, `inline code`. HTML also accepted.";

export function markdownToHtml(text: string): string {
  if (looksLikeHtml(text)) return text;
  if (!hasMarkdownPatterns(text)) return escapeHtml(text);

  const lines = text.split("\n");
  const output: string[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    lineIndex =
      consumeFencedCodeBlock(lines, lineIndex, output) ??
      consumeListBlock(lines, lineIndex, output) ??
      consumeSingleLine(lines, lineIndex, output);
  }

  return output.join("\n");
}

function looksLikeHtml(text: string): boolean {
  return /<\/?(?:div|p|ul|ol|li|h[1-6]|br|table|tr|td|th)\b/i.test(text);
}

function hasMarkdownPatterns(text: string): boolean {
  return /^#{1,3}\s|^\*\s|^-\s|\*\*.*\*\*|^\d+\.\s|```|`.+`/m.test(text);
}

function convertInlineFormatting(line: string): string {
  // Escape first so user text can't inject HTML. Markdown markers (`*`, backtick)
  // are ASCII and untouched by escaping, and the formatting tags we emit below are
  // added after escaping, so they survive as real markup.
  let result = escapeHtml(line);

  result = result.replace(
    /`([^`]+)`/g,
    '<font face="Courier"><tt>$1</tt></font>',
  );

  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  return result;
}

function consumeFencedCodeBlock(
  lines: string[],
  lineIndex: number,
  output: string[],
): number | null {
  if (!lines[lineIndex].startsWith("```")) return null;
  lineIndex++;

  while (lineIndex < lines.length && !lines[lineIndex].startsWith("```")) {
    output.push(
      `<div><font face="Courier"><tt>${escapeHtml(lines[lineIndex])}</tt></font></div>`,
    );

    lineIndex++;
  }

  if (lineIndex < lines.length) lineIndex++;
  return lineIndex;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const LIST_KINDS = [
  { tag: "ul", marker: /^[-*]\s+/ },
  { tag: "ol", marker: /^\d+\.\s+/ },
];

function consumeListBlock(
  lines: string[],
  lineIndex: number,
  output: string[],
): number | null {
  const kind = LIST_KINDS.find((candidate) => candidate.marker.test(lines[lineIndex]));
  if (!kind) return null;
  output.push(`<${kind.tag}>`);

  while (lineIndex < lines.length && kind.marker.test(lines[lineIndex])) {
    const content = lines[lineIndex].replace(kind.marker, "");
    output.push(`<li>${convertInlineFormatting(content)}</li>`);
    lineIndex++;
  }

  output.push(`</${kind.tag}>`);
  return lineIndex;
}

function consumeSingleLine(
  lines: string[],
  lineIndex: number,
  output: string[],
): number {
  const line = lines[lineIndex];
  const heading = line.match(/^(#{1,3})\s+(.+)/);

  if (heading) {
    const tag = `h${heading[1].length}`;
    output.push(`<${tag}>${convertInlineFormatting(heading[2])}</${tag}>`);
  } else if (line.trim() === "") {
    output.push("<br>");
  } else {
    output.push(`<div>${convertInlineFormatting(line)}</div>`);
  }

  return lineIndex + 1;
}
