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
      'allday due date:date "20 June 2026 at 12:00:00 AM"',
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

    expect(scripts[0]).toContain('due date:date "20 June 2026 at 9:30:00 AM"');
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
    expect(scripts[0]).toContain("whose completed is false");
  });

  test("reads every reminder when completed ones are included", async () => {
    const { run, scripts } = recordingRun("");
    const lines = await createReminders(run).list({
      listName: "Inbox",
      includeCompleted: true,
    });

    expect(lines).toEqual([]);
    expect(scripts[0]).toContain("name of every reminder");
    expect(scripts[0]).not.toContain("whose completed");
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
