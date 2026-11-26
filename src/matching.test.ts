import { describe, expect, test } from "bun:test";
import { deleteFirstMatching, eventSpecifier, whoseClause } from "./matching.ts";

describe("whoseClause", () => {
  test("matches by name", () => {
    expect(whoseClause({ nameProperty: "summary", name: 'a "b"' })).toBe(
      'summary is "a \\"b\\""',
    );
  });

  test("matches by id", () => {
    expect(whoseClause({ nameProperty: "summary", id: "ABC" })).toBe('id is "ABC"');
  });

  test("rejects neither or both", () => {
    expect(() => whoseClause({ nameProperty: "name" })).toThrow(
      "Provide exactly one of name or id.",
    );

    expect(() => whoseClause({ nameProperty: "name", name: "x", id: "y" })).toThrow(
      "Provide exactly one of name or id.",
    );
  });
});

describe("eventSpecifier", () => {
  test("addresses an event by id directly and by title through a filter", () => {
    expect(eventSpecifier({ id: "UID-1" })).toBe('event id "UID-1"');
    expect(eventSpecifier({ title: "Old" })).toBe('first event whose summary is "Old"');
  });

  test("rejects neither or both", () => {
    expect(() => eventSpecifier({})).toThrow("Provide exactly one of title or id.");

    expect(() => eventSpecifier({ title: "x", id: "y" })).toThrow(
      "Provide exactly one of title or id.",
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
