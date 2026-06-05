export function markdownToHtml(text: string): string {
  if (looksLikeHtml(text)) return text;
  if (!hasMarkdownPatterns(text)) return text;

  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    i = consumeCheckboxBlock(lines, i, output)
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
  return /^#{1,3}\s|^\*\s|^-\s|^>\s|\*\*.*\*\*|^\d+\.\s|^-\s*\[[ x]\]/m.test(text);
}

// ── Inline formatting ───────────────────────────────────────────────

function convertInlineFormatting(line: string): string {
  let result = line;
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  return result;
}

// ── Block consumers ─────────────────────────────────────────────────
// Each returns the next index if it matched, or null to fall through.

function consumeCheckboxBlock(lines: string[], i: number, output: string[]): number | null {
  if (!isCheckboxLine(lines[i])) return null;
  while (i < lines.length && isCheckboxLine(lines[i])) {
    output.push(`<div>${convertCheckbox(lines[i])}</div>`);
    i++;
  }
  return i;
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
  } else if ((match = line.match(/^>\s*(.*)/))) {
    output.push(`<blockquote>${convertInlineFormatting(match[1])}</blockquote>`);
  } else if (line.trim() === "") {
    output.push("<br>");
  } else {
    output.push(`<div>${convertInlineFormatting(line)}</div>`);
  }
  return i + 1;
}

// ── Line matchers ───────────────────────────────────────────────────

function isCheckboxLine(line: string): boolean {
  return /^-\s*\[[ x]\]/i.test(line);
}

function isBulletLine(line: string): boolean {
  return /^[-*]\s+/.test(line) && !isCheckboxLine(line);
}

function isNumberedLine(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function convertCheckbox(line: string): string {
  return line
    .replace(/^-\s*\[\s\]\s*/, "☐ ")
    .replace(/^-\s*\[x\]\s*/i, "☑ ");
}
