// Lives here so the advertised capabilities stay next to the converter that
// implements them.
export const MARKDOWN_SYNTAX_DESCRIPTION =
  "Supports markdown: # headings, - bullets, 1. numbered, **bold**, *italic*, ```code blocks```, `inline code`. HTML also accepted.";

export function markdownToHtml(text: string): string {
  if (looksLikeHtml(text)) return text;
  if (!hasMarkdownPatterns(text)) return escapeHtml(text);

  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    i =
      consumeFencedCodeBlock(lines, i, output) ??
      consumeBulletBlock(lines, i, output) ??
      consumeNumberedBlock(lines, i, output) ??
      consumeSingleLine(lines, i, output);
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
  i: number,
  output: string[],
): number | null {
  if (!lines[i].startsWith("```")) return null;
  i++;
  while (i < lines.length && !lines[i].startsWith("```")) {
    output.push(
      `<div><font face="Courier"><tt>${escapeHtml(lines[i])}</tt></font></div>`,
    );
    i++;
  }
  if (i < lines.length) i++;
  return i;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function consumeBulletBlock(
  lines: string[],
  i: number,
  output: string[],
): number | null {
  if (!isBulletLine(lines[i])) return null;
  output.push("<ul>");
  while (i < lines.length && isBulletLine(lines[i])) {
    const content = lines[i].replace(/^[-*]\s+/, "");
    output.push(`<li>${convertInlineFormatting(content)}</li>`);
    i++;
  }
  output.push("</ul>");
  return i;
}

function consumeNumberedBlock(
  lines: string[],
  i: number,
  output: string[],
): number | null {
  if (!isNumberedLine(lines[i])) return null;
  output.push("<ol>");
  while (i < lines.length && isNumberedLine(lines[i])) {
    const content = lines[i].replace(/^\d+\.\s+/, "");
    output.push(`<li>${convertInlineFormatting(content)}</li>`);
    i++;
  }
  output.push("</ol>");
  return i;
}

function consumeSingleLine(
  lines: string[],
  i: number,
  output: string[],
): number {
  const line = lines[i];
  const heading = line.match(/^(#{1,3})\s+(.+)/);
  if (heading) {
    const tag = `h${heading[1].length}`;
    output.push(`<${tag}>${convertInlineFormatting(heading[2])}</${tag}>`);
  } else if (line.trim() === "") {
    output.push("<br>");
  } else {
    output.push(`<div>${convertInlineFormatting(line)}</div>`);
  }
  return i + 1;
}

function isBulletLine(line: string): boolean {
  return /^[-*]\s+/.test(line);
}

function isNumberedLine(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}
