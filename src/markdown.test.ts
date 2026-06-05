import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "./markdown.ts";

describe("passthrough", () => {
  test("plain text without markdown patterns", () => {
    expect(markdownToHtml("hello world")).toBe("hello world");
  });

  test("existing HTML is returned as-is", () => {
    const html = "<div>already formatted</div>";
    expect(markdownToHtml(html)).toBe(html);
  });
});

describe("headings", () => {
  test("h1", () => {
    expect(markdownToHtml("# Title")).toBe("<h1>Title</h1>");
  });

  test("h2", () => {
    expect(markdownToHtml("## Subtitle")).toBe("<h2>Subtitle</h2>");
  });

  test("h3", () => {
    expect(markdownToHtml("### Section")).toBe("<h3>Section</h3>");
  });
});

describe("inline formatting", () => {
  test("bold", () => {
    expect(markdownToHtml("**bold** text")).toBe("<div><b>bold</b> text</div>");
  });

  test("italic alongside bold triggers conversion", () => {
    expect(markdownToHtml("**bold** and *italic*")).toContain("<i>italic</i>");
  });

  test("italic alone does not trigger conversion", () => {
    expect(markdownToHtml("*italic* text")).toBe("*italic* text");
  });

  test("inline code", () => {
    expect(markdownToHtml("use `fmt.Println`")).toBe(
      '<div>use <font face="Courier"><tt>fmt.Println</tt></font></div>',
    );
  });

  test("bold and italic together", () => {
    expect(markdownToHtml("**bold** and *italic*")).toBe(
      "<div><b>bold</b> and <i>italic</i></div>",
    );
  });
});

describe("bullet lists", () => {
  test("dash bullets", () => {
    expect(markdownToHtml("- one\n- two")).toBe(
      "<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
    );
  });

  test("asterisk bullets", () => {
    expect(markdownToHtml("* one\n* two")).toBe(
      "<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
    );
  });

  test("inline formatting inside bullets", () => {
    expect(markdownToHtml("- **bold item**")).toBe(
      "<ul>\n<li><b>bold item</b></li>\n</ul>",
    );
  });
});

describe("numbered lists", () => {
  test("basic numbered list", () => {
    expect(markdownToHtml("1. first\n2. second")).toBe(
      "<ol>\n<li>first</li>\n<li>second</li>\n</ol>",
    );
  });

  test("inline formatting inside numbered items", () => {
    expect(markdownToHtml("1. use `code` here")).toBe(
      '<ol>\n<li>use <font face="Courier"><tt>code</tt></font> here</li>\n</ol>',
    );
  });
});

describe("fenced code blocks", () => {
  test("simple code block", () => {
    expect(markdownToHtml("```\nconst x = 1;\n```")).toBe(
      '<div><font face="Courier"><tt>const x = 1;</tt></font></div>',
    );
  });

  test("HTML inside fenced block triggers looksLikeHtml passthrough", () => {
    const input = "```\n<div>test</div>\n```";
    expect(markdownToHtml(input)).toBe(input);
  });

  test("language tag is ignored", () => {
    expect(markdownToHtml("```ts\nlet a = 1;\n```")).toBe(
      '<div><font face="Courier"><tt>let a = 1;</tt></font></div>',
    );
  });
});

describe("HTML escaping", () => {
  test("plain text with HTML entities is not escaped on passthrough", () => {
    expect(markdownToHtml("Tom & Jerry <3")).toBe("Tom & Jerry <3");
  });

  test("ampersand in markdown lines is not escaped", () => {
    expect(markdownToHtml("- A & B")).toBe("<ul>\n<li>A & B</li>\n</ul>");
  });

  test("fenced code blocks escape HTML", () => {
    // <script> not <div>, to avoid triggering looksLikeHtml passthrough
    expect(markdownToHtml("```\n<script>&</script>\n```")).toBe(
      '<div><font face="Courier"><tt>&lt;script&gt;&amp;&lt;/script&gt;</tt></font></div>',
    );
  });
});

describe("current markdown escaping limitations", () => {
  test("HTML tags in headings currently pass through unescaped", () => {
    expect(markdownToHtml("# <script>alert(1)</script>")).toBe(
      "<h1><script>alert(1)</script></h1>",
    );
  });

  test("HTML tags in bullet items currently pass through unescaped", () => {
    expect(markdownToHtml("- <img src=x>")).toBe(
      "<ul>\n<li><img src=x></li>\n</ul>",
    );
  });

  test("HTML tags in plain lines currently pass through unescaped", () => {
    expect(markdownToHtml("**bold** then <script>x</script>")).toBe(
      "<div><b>bold</b> then <script>x</script></div>",
    );
  });

  test("HTML inside inline code currently passes through unescaped", () => {
    // <script> not <div>, to avoid triggering looksLikeHtml passthrough
    expect(markdownToHtml("use `<script>` tag")).toBe(
      '<div>use <font face="Courier"><tt><script></tt></font> tag</div>',
    );
  });
});

describe("current inline code formatting limitations", () => {
  test("bold markers inside inline code are currently processed as bold", () => {
    const result = markdownToHtml("use `**not bold**` here");
    expect(result).toContain("<b>not bold</b>");
  });

  test("italic markers inside inline code are currently processed as italic", () => {
    const result = markdownToHtml("use `*x*` here");
    expect(result).toContain("<i>");
  });
});

describe("mixed content", () => {
  test("heading followed by paragraph", () => {
    expect(markdownToHtml("# Title\n\nSome text")).toBe(
      "<h1>Title</h1>\n<br>\n<div>Some text</div>",
    );
  });

  test("paragraph then list", () => {
    expect(markdownToHtml("intro:\n- a\n- b")).toBe(
      "<div>intro:</div>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>",
    );
  });

  test("empty lines become br", () => {
    expect(markdownToHtml("# Heading\n\n\n# Another")).toBe(
      "<h1>Heading</h1>\n<br>\n<br>\n<h1>Another</h1>",
    );
  });
});
