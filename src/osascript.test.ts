import { describe, expect, test } from "bun:test";
import {
  appleScriptDateStatements,
  deleteFirstMatching,
  matchClause,
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
    const joined = "Shopping, urgent\nWork\nHome";
    expect(parseList(joined)).toEqual(["Shopping, urgent", "Work", "Home"]);
  });
});

describe("appleScriptDateStatements", () => {
  test("builds an ISO date-time from numbers", () => {
    expect(appleScriptDateStatements("theDate", "2026-06-07 10:00:00")).toBe(
      `set theDate to current date
set day of theDate to 1
set year of theDate to 2026
set month of theDate to 6
set day of theDate to 7
set time of theDate to 36000`,
    );
  });

  test("puts ISO date-only strings at midnight", () => {
    expect(appleScriptDateStatements("theDate", "2026-06-07")).toContain(
      "set time of theDate to 0",
    );
  });

  test("supports ISO strings with T separators and omitted seconds", () => {
    expect(appleScriptDateStatements("theDate", "2026-06-07T22:05")).toContain(
      "set time of theDate to 79500",
    );
  });

  test("rejects invalid ISO-like dates", () => {
    expect(() => appleScriptDateStatements("theDate", "2026-02-29 10:00:00")).toThrow(
      "Invalid ISO date",
    );
  });

  test("rejects non-ISO dates, which AppleScript would parse by locale", () => {
    expect(() => appleScriptDateStatements("theDate", "30/11/2026 09:00:00")).toThrow(
      "Invalid date: 30/11/2026 09:00:00",
    );
  });
});

describe("matchClause", () => {
  test("matches by name", () => {
    expect(matchClause({ nameProperty: "summary", name: 'a "b"' })).toEqual({
      clause: 'summary is "a \\"b\\""',
      label: '"a \\"b\\""',
    });
  });

  test("matches by id with a custom id property", () => {
    expect(
      matchClause({ nameProperty: "summary", id: "ABC", idProperty: "uid" }),
    ).toEqual({ clause: 'uid is "ABC"', label: "with id ABC" });
  });

  test("rejects neither or both", () => {
    expect(() => matchClause({ nameProperty: "name" })).toThrow("exactly one");
    expect(() => matchClause({ nameProperty: "name", name: "x", id: "y" })).toThrow(
      "exactly one",
    );
  });
});

describe("deleteFirstMatching", () => {
  test("errors when nothing matches before deleting", () => {
    expect(deleteFirstMatching("event", 'uid is "X"')).toBe(
      `if (count of (every event whose uid is "X")) is 0 then error "No matching event." number 1
  delete (first event whose uid is "X")`,
    );
  });
});
