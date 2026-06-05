export function markdownToHtml(text: string): string {
  if (looksLikeHtml(text)) return text;
  if (!hasMarkdownPatterns(text)) return text;

  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    i = consumeFencedCodeBlock(lines, i, output)
      ?? consumeBulletBlock(lines, i, output)
      ?? consumeNumberedBlock(lines, i, output)
      ?? consumeSingleLine(lines, i, output);
  }

  return output.join("\n");
}

function looksLikeHtml(text: string): boolean {
  return /<\/?(?:div|p|ul|ol|li|h[1-6]|br|table|tr|td|th)\b/i.test(text);
}

function hasMarkdownPatterns(text: string): boolean {
  return /^#{1,3}\s|^\*\s|^-\s|\*\*.*\*\*|^\d+\.\s|```|`.+`/m.test(text);
}

// ── Inline formatting ───────────────────────────────────────────────

function convertInlineFormatting(line: string): string {
  let result = line;
  result = result.replace(/`([^`]+)`/g, "<font face=\"Courier\"><tt>$1</tt></font>");
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  return result;
}

// ── Block consumers ─────────────────────────────────────────────────
// Each returns the next index if it matched, or null to fall through.

function consumeFencedCodeBlock(lines: string[], i: number, output: string[]): number | null {
  if (!lines[i].startsWith("```")) return null;
  i++;
  while (i < lines.length && !lines[i].startsWith("```")) {
    output.push(`<div><font face="Courier"><tt>${escapeHtml(lines[i])}</tt></font></div>`);
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

function consumeBulletBlock(lines: string[], i: number, output: string[]): number | null {
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

function consumeNumberedBlock(lines: string[], i: number, output: string[]): number | null {
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

function consumeSingleLine(lines: string[], i: number, output: string[]): number {
  const line = lines[i];
  let match: RegExpMatchArray | null;
  if ((match = line.match(/^###\s+(.+)/))) {
    output.push(`<h3>${convertInlineFormatting(match[1])}</h3>`);
  } else if ((match = line.match(/^##\s+(.+)/))) {
    output.push(`<h2>${convertInlineFormatting(match[1])}</h2>`);
  } else if ((match = line.match(/^#\s+(.+)/))) {
    output.push(`<h1>${convertInlineFormatting(match[1])}</h1>`);
  } else if (line.trim() === "") {
    output.push("<br>");
  } else {
    output.push(`<div>${convertInlineFormatting(line)}</div>`);
  }
  return i + 1;
}

// ── Line matchers ───────────────────────────────────────────────────

function isBulletLine(line: string): boolean {
  return /^[-*]\s+/.test(line);
}

function isNumberedLine(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}
