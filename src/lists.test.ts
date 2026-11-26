import { describe, expect, test } from "bun:test";
import { nameListScript, parseList } from "./lists.ts";

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
    const joined = "Shopping, urgent\nWork\nHome";

    expect(parseList(joined)).toEqual(["Shopping, urgent", "Work", "Home"]);
  });
});
