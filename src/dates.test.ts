import { describe, expect, test } from "bun:test";
import { appleScriptDateStatements } from "./dates.ts";

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
