import { describe, expect, test } from "bun:test";
import { createReminders } from "./reminders.ts";
import { recordingRun } from "./testing.ts";

const ID = "x-apple-reminder://80C37AE0-1557-46BA-8185-5123E469B9D8";

describe("reminders.create", () => {
  test("uses all-day due dates for ISO date-only input", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);
    await createReminders(run).create({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20",
    });

    expect(scripts[0]).toContain(
      'allday due date:date "20 June 2026 12:00:00 AM"',
    );
    expect(scripts[0]).not.toContain(", due date:");
  });

  test("uses timed due dates when the input includes a time", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);
    await createReminders(run).create({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20 09:30:00",
    });

    expect(scripts[0]).toContain('due date:date "20 June 2026 9:30:00 AM"');
    expect(scripts[0]).not.toContain("allday due date:");
  });

  test("allDay forces the all-day due date property", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);
    await createReminders(run).create({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "June 20, 2026 9:30 AM",
      allDay: true,
    });

    expect(scripts[0]).toContain('allday due date:date "June 20, 2026 9:30 AM"');
    expect(scripts[0]).not.toContain(", due date:");
  });

  test("escapes list, title, and notes", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);
    await createReminders(run).create({
      listName: 'Inbox "Main"',
      name: 'Pay \\ "Bill"',
      notes: 'Use "checking"',
    });

    expect(scripts[0]).toContain('list "Inbox \\"Main\\""');
    expect(scripts[0]).toContain('name:"Pay \\\\ \\"Bill\\""');
    expect(scripts[0]).toContain('body:"Use \\"checking\\""');
  });

  test("returns the id from the make result", async () => {
    const { run } = recordingRun(`reminder id ${ID}`);
    const created = await createReminders(run).create({
      listName: "Inbox",
      name: "x",
    });
    expect(created).toEqual({ id: ID });
  });

  test("returns a quoted id with a trailing specifier", async () => {
    const { run } = recordingRun(
      'reminder id "x-apple-reminder://ABC" of list id "L1" of application "Reminders"',
    );
    const created = await createReminders(run).create({
      listName: "Inbox",
      name: "x",
    });
    expect(created.id).toBe("x-apple-reminder://ABC");
  });

  test("throws when the result carries no id", async () => {
    const { run } = recordingRun("");
    await expect(
      createReminders(run).create({ listName: "Inbox", name: "x" }),
    ).rejects.toThrow("No reminder id");
  });
});

describe("reminders.list", () => {
  test("filters completed reminders in-script by default", async () => {
    const { run, scripts } = recordingRun("- a\n- b");
    const lines = await createReminders(run).list({ listName: "Inbox" });

    expect(lines).toEqual(["- a", "- b"]);
    expect(scripts[0]).toContain('repeat with l in {list "Inbox"}');
    expect(scripts[0]).toContain("whose completed is false");
    expect(scripts[0]).toContain('" | id: " & id of r');
  });

  test("joins multi-line notes with a separator so each reminder stays on one line", async () => {
    const { run, scripts } = recordingRun();
    await createReminders(run).list({ listName: "Inbox" });

    expect(scripts[0]).toContain(
      "set AppleScript's text item delimiters to {return & linefeed, return, linefeed}",
    );
    expect(scripts[0]).toContain('set AppleScript\'s text item delimiters to " / "');
    expect(scripts[0]).toContain('" | notes: " & (b as text)');
  });

  test("reads every reminder when completed ones are included", async () => {
    const { run, scripts } = recordingRun("");
    const lines = await createReminders(run).list({
      listName: "Inbox",
      includeCompleted: true,
    });

    expect(lines).toEqual([]);
    expect(scripts[0]).toContain("name of every reminder");
    expect(scripts[0]).toContain("set idList to id of every reminder");
    expect(scripts[0]).toContain('" | id: " & item i of idList');
    expect(scripts[0]).not.toContain("whose completed");
  });
});

describe("reminders.search", () => {
  test("walks every list and prefixes lines with the list name", async () => {
    const { run, scripts } = recordingRun("Inbox: a | id: x");
    const lines = await createReminders(run).search({ query: 'Pay "bill"' });

    expect(lines).toEqual(["Inbox: a | id: x"]);
    expect(scripts[0]).toContain("repeat with l in every list");
    expect(scripts[0]).toContain(
      'properties of (every reminder of l whose completed is false and name contains "Pay \\"bill\\"")',
    );
    expect(scripts[0]).toContain('set line_ to (name of l) & ": " & name of r');
    expect(scripts[0]).toContain('" | id: " & id of r');
  });

  test("returns names only when completed reminders are included", async () => {
    const { run, scripts } = recordingRun("a\nb");
    const lines = await createReminders(run).search({
      query: "a",
      includeCompleted: true,
    });

    expect(lines).toEqual(["a", "b"]);
    expect(scripts[0]).toContain('name of (every reminder whose name contains "a")');
    expect(scripts[0]).not.toContain("completed is false");
  });
});

describe("reminders.update", () => {
  test("sets only the given fields on the matched reminder", async () => {
    const { run, scripts } = recordingRun();
    await createReminders(run).update({
      listName: "Inbox",
      id: "x-apple-reminder://ABC",
      title: "New",
      dueDate: "2026-12-11 14:00",
    });

    expect(scripts[0]).toContain('tell (first reminder whose id is "x-apple-reminder://ABC")');
    expect(scripts[0]).toContain('error "No matching reminder."');
    expect(scripts[0]).toContain('set name to "New"');
    expect(scripts[0]).toContain('set due date to date "11 December 2026 2:00:00 PM"');
    expect(scripts[0]).not.toContain("set body");
    expect(scripts[0]).not.toContain("set priority");
  });

  test("date-only due dates become all-day", async () => {
    const { run, scripts } = recordingRun();
    await createReminders(run).update({ listName: "Inbox", name: "a", dueDate: "2026-12-12" });
    expect(scripts[0]).toContain('set allday due date to date "12 December 2026 12:00:00 AM"');
  });

  test("rejects an empty update before running anything", async () => {
    const { run, scripts } = recordingRun();
    await expect(
      createReminders(run).update({ listName: "Inbox", name: "a" }),
    ).rejects.toThrow("Nothing to update");
    expect(scripts).toEqual([]);
  });
});

describe("reminders.complete and delete", () => {
  test("match by id when given", async () => {
    const { run, scripts } = recordingRun();
    const reminders = createReminders(run);
    await reminders.complete({ listName: "Inbox", id: "x-apple-reminder://ABC" });
    await reminders.delete({ listName: "Inbox", name: "Pay bill" });

    expect(scripts[0]).toContain('whose id is "x-apple-reminder://ABC"');
    expect(scripts[1]).toContain('whose name is "Pay bill"');
  });

  test("reject neither or both of name and id", async () => {
    const reminders = createReminders(recordingRun().run);
    await expect(reminders.complete({ listName: "Inbox" })).rejects.toThrow(
      "exactly one",
    );
    await expect(
      reminders.delete({ listName: "Inbox", name: "a", id: "b" }),
    ).rejects.toThrow("exactly one");
  });
});
