import { describe, expect, test } from "bun:test";
import { createNotes } from "./notes.ts";
import { recordingRun } from "./testing.ts";

describe("notes", () => {
  test("create converts markdown and scopes to the folder", async () => {
    const { run, scripts } = recordingRun();
    await createNotes(run).create({
      title: "Plan",
      body: "# Title\n- item",
      folder: "Work",
    });

    expect(scripts[0]).toContain('tell folder "Work" to make new note');
    expect(scripts[0]).toContain("<h1>Title</h1>");
    expect(scripts[0]).toContain("<li>item</li>");
  });

  test("edit rejects an empty update before running anything", async () => {
    const { run, scripts } = recordingRun();
    await expect(createNotes(run).edit({ name: "Plan" })).rejects.toThrow(
      "Nothing to update",
    );
    expect(scripts).toEqual([]);
  });

  test("edit sets only the provided fields", async () => {
    const { run, scripts } = recordingRun();
    await createNotes(run).edit({ name: "Plan", title: "New" });

    expect(scripts[0]).toContain('set name of n to "New"');
    expect(scripts[0]).not.toContain("set body of n");
  });

  test("read picks plaintext when html is off", async () => {
    const { run, scripts } = recordingRun("hello");
    expect(await createNotes(run).read({ name: "Plan", html: false })).toBe("hello");
    expect(scripts[0]).toContain("plaintext of first note");
  });

  test("search scopes to a folder and body text", async () => {
    const { run, scripts } = recordingRun("Plan\nNotes, misc");
    const names = await createNotes(run).search({
      query: "x",
      searchContent: true,
      folder: "Work",
    });

    expect(names).toEqual(["Plan", "Notes, misc"]);
    expect(scripts[0]).toContain('every note in folder "Work" whose plaintext contains "x"');
  });
});
