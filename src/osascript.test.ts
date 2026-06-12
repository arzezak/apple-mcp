import { describe, expect, test } from "bun:test";
import {
  appleScriptDateLiteral,
  nameListScript,
  parseList,
} from "./osascript.ts";

describe("parseList", () => {
  test("splits linefeed-separated items", () => {
    expect(parseList("Work\nHome\nSchool")).toEqual(["Work", "Home", "School"]);
  });

  test("returns single item", () => {
    expect(parseList("Work")).toEqual(["Work"]);
  });

  test("returns empty array for empty string", () => {
    expect(parseList("")).toEqual([]);
  });

  test("returns empty array for missing value", () => {
    expect(parseList("missing value")).toEqual([]);
  });

  test("trims surrounding whitespace from items", () => {
    expect(parseList("  a \n b \n c ")).toEqual(["a", "b", "c"]);
  });

  test("filters out empty lines", () => {
    expect(parseList("\n\na")).toEqual(["a"]);
  });

  test("preserves names containing comma-space", () => {
    expect(parseList("Shopping, urgent\nWork")).toEqual([
      "Shopping, urgent",
      "Work",
    ]);
  });
});

describe("nameListScript", () => {
  test("joins the list with linefeed so parseList can split unambiguously", () => {
    const script = nameListScript("Reminders", "name of every list");
    expect(script).toBe(
      `tell application "Reminders" to set resultList to name of every list
set AppleScript's text item delimiters to linefeed
resultList as text`,
    );
  });

  test("round-trips with parseList: comma-space names survive", () => {
    // Simulates the linefeed-joined text the script produces.
    const joined = "Shopping, urgent\nWork\nHome";
    expect(parseList(joined)).toEqual(["Shopping, urgent", "Work", "Home"]);
  });
});

describe("appleScriptDateLiteral", () => {
  test("normalizes ISO date-time strings to unambiguous AppleScript dates", () => {
    expect(appleScriptDateLiteral("2026-06-07 10:00:00")).toBe(
      'date "7 June 2026 at 10:00:00 AM"',
    );
  });

  test("normalizes ISO date-only strings to midnight", () => {
    expect(appleScriptDateLiteral("2026-06-07")).toBe(
      'date "7 June 2026 at 12:00:00 AM"',
    );
  });

  test("supports ISO strings with T separators and omitted seconds", () => {
    expect(appleScriptDateLiteral("2026-06-07T22:05")).toBe(
      'date "7 June 2026 at 10:05:00 PM"',
    );
  });

  test("rejects invalid ISO-like dates instead of falling through to AppleScript", () => {
    expect(() => appleScriptDateLiteral("2026-02-29 10:00:00")).toThrow(
      "Invalid ISO date",
    );
  });

  test("preserves non-ISO locale date strings", () => {
    expect(appleScriptDateLiteral("7 June 2026 10:00 AM")).toBe(
      'date "7 June 2026 10:00 AM"',
    );
  });
});
