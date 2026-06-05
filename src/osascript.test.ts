import { describe, expect, test } from "bun:test";
import { appleScriptDateLiteral, parseList } from "./osascript.ts";

describe("parseList", () => {
  test("splits comma-separated items", () => {
    expect(parseList("Work, Home, School")).toEqual(["Work", "Home", "School"]);
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

  test("trims whitespace from items", () => {
    expect(parseList("  a , b , c ")).toEqual(["a", "b", "c"]);
  });

  test("filters out empty items", () => {
    expect(parseList(", , a")).toEqual(["a"]);
  });
});

describe("current parseList limitations", () => {
  test("items containing comma-space are currently split as separate items", () => {
    expect(parseList("Work, Personal, Home")).toEqual([
      "Work",
      "Personal",
      "Home",
    ]);
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
