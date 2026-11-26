import { describe, expect, test } from "bun:test";
import { createReminders } from "./reminders.ts";
import { recordingRun } from "./testing.ts";
import type { ReminderRecord, ReminderScope } from "./eventkit.ts";

const ID = "x-apple-reminder://80C37AE0-1557-46BA-8185-5123E469B9D8";

describe("reminders.create", () => {
  test("uses all-day due dates for ISO date-only input", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);

    await createReminders(run).create({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20",
    });

    expect(scripts[0]).toContain("set day of theDueDate to 20");
    expect(scripts[0]).toContain("allday due date:theDueDate");
    expect(scripts[0]).not.toContain(", due date:");
  });

  test("uses timed due dates when the input includes a time", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);

    await createReminders(run).create({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20 09:30:00",
    });

    expect(scripts[0]).toContain("set time of theDueDate to 34200");
    expect(scripts[0]).toContain(", due date:theDueDate");
    expect(scripts[0]).not.toContain("allday due date:");
  });

  test("allDay forces the all-day due date property", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);

    await createReminders(run).create({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20 09:30:00",
      allDay: true,
    });

    expect(scripts[0]).toContain("allday due date:theDueDate");
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

describe("reminders.create with recurrence", () => {
  test("attaches the rule through EventKit after the AppleScript make", async () => {
    const { run, scripts, languages } = recordingRun(`reminder id ${ID}`);

    const created = await createReminders(run).create({
      listName: "Inbox",
      name: "Rent",
      recurrence: { frequency: "monthly", interval: 1 },
    });

    expect(created).toEqual({ id: ID, recurrenceRule: "FREQ=MONTHLY;INTERVAL=1" });
    expect(languages).toEqual([undefined, "JavaScript"]);

    expect(scripts[1]).toContain(
      'calendarItemWithIdentifier("80C37AE0-1557-46BA-8185-5123E469B9D8")',
    );

    expect(scripts[1]).toContain("initRecurrenceWithFrequencyIntervalEnd(2, 1, $())");
  });

  test("ends by count or by until date", async () => {
    const { run, scripts } = recordingRun(`reminder id ${ID}`);
    const reminders = createReminders(run);

    await reminders.create({
      listName: "Inbox",
      name: "x",
      recurrence: { frequency: "weekly", interval: 2, count: 5 },
    });

    await reminders.create({
      listName: "Inbox",
      name: "x",
      recurrence: { frequency: "daily", interval: 1, until: "2027-01-01T00:00:00Z" },
    });

    expect(scripts[1]).toContain("recurrenceEndWithOccurrenceCount(5)");
    expect(scripts[3]).toContain("dateWithTimeIntervalSince1970(1798761600)");
  });

  test("reports the created id when the recurrence step fails", async () => {
    let calls = 0;

    const run = async () => {
      if (calls++ === 0) return `reminder id ${ID}`;
      throw new Error("AppleScript error: no access");
    };

    await expect(
      createReminders(run).create({
        listName: "Inbox",
        name: "x",
        recurrence: { frequency: "daily", interval: 1 },
      }),
    ).rejects.toThrow(`(id: ${ID}) but could not attach the recurrence: AppleScript error: no access`);
  });

  test("rejects invalid rules before creating anything", async () => {
    const { run, scripts } = recordingRun();

    await expect(
      createReminders(run).create({
        listName: "Inbox",
        name: "x",
        recurrence: { frequency: "daily", interval: 1, count: 2, until: "2027-01-01" },
      }),
    ).rejects.toThrow("count or until, not both");

    expect(scripts).toEqual([]);
  });
});

describe("reminders.list and search", () => {
  function reminderRecord(overrides: Partial<ReminderRecord> = {}): ReminderRecord {
    return {
      list: "Inbox",
      name: "Pay rent",
      notes: "",
      priority: 0,
      due: null,
      timed: false,
      id: "x-apple-reminder://ABC",
      ...overrides,
    };
  }

  function remindersWith(records: ReminderRecord[]) {
    const scopes: ReminderScope[] = [];

    const reminders = createReminders(recordingRun().run, {
      readReminders: async (scope) => {
        scopes.push(scope);
        return records;
      },
    });

    return { reminders, scopes };
  }

  test("lists the incomplete reminders of one list by default", async () => {
    const { reminders, scopes } = remindersWith([reminderRecord()]);

    const lines = await reminders.list({ listName: "Inbox" });

    expect(scopes).toEqual([{ listName: "Inbox", includeCompleted: false }]);
    expect(lines).toEqual(["- Pay rent | id: x-apple-reminder://ABC"]);
  });

  test("reads completed reminders too when asked", async () => {
    const { reminders, scopes } = remindersWith([]);

    const lines = await reminders.list({ listName: "Inbox", includeCompleted: true });

    expect(scopes).toEqual([{ listName: "Inbox", includeCompleted: true }]);
    expect(lines).toEqual([]);
  });

  test("shows a timed due date with its time and an all-day one without", async () => {
    const { reminders } = remindersWith([
      reminderRecord({ due: new Date(2026, 10, 26, 9, 30), timed: true }),
      reminderRecord({ due: new Date(2026, 10, 27), timed: false }),
    ]);

    const lines = await reminders.list({ listName: "Inbox" });

    expect(lines).toEqual([
      "- Pay rent | due: Thursday, November 26, 2026 at 9:30:00 AM | id: x-apple-reminder://ABC",
      "- Pay rent | due: Friday, November 27, 2026 | id: x-apple-reminder://ABC",
    ]);
  });

  test("adds priority and joins multi-line notes so each reminder stays on one line", async () => {
    const { reminders } = remindersWith([
      reminderRecord({ priority: 1, notes: "first\r\nsecond\n\nthird" }),
    ]);

    const lines = await reminders.list({ listName: "Inbox" });

    expect(lines).toEqual([
      "- Pay rent | priority: 1 | notes: first / second / third | id: x-apple-reminder://ABC",
    ]);
  });

  test("search reads every list, matches names ignoring case and prefixes the list", async () => {
    const { reminders, scopes } = remindersWith([
      reminderRecord({ list: "Home", name: 'Pay "BILL" today' }),
      reminderRecord({ name: "Call Sam" }),
    ]);

    const lines = await reminders.search({ query: 'pay "bill"' });

    expect(scopes).toEqual([{ includeCompleted: false }]);
    expect(lines).toEqual(['Home: Pay "BILL" today | id: x-apple-reminder://ABC']);
  });

  test("search returns full lines for completed reminders too", async () => {
    const { reminders, scopes } = remindersWith([reminderRecord({ priority: 5 })]);

    const lines = await reminders.search({ query: "rent", includeCompleted: true });

    expect(scopes).toEqual([{ includeCompleted: true }]);
    expect(lines).toEqual(["Inbox: Pay rent | priority: 5 | id: x-apple-reminder://ABC"]);
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
    expect(scripts[0]).toContain("set time of theDueDate to 50400");
    expect(scripts[0]).toContain("set due date to theDueDate");
    expect(scripts[0]).not.toContain("set body");
    expect(scripts[0]).not.toContain("set priority");
  });

  test("date-only due dates become all-day", async () => {
    const { run, scripts } = recordingRun();
    await createReminders(run).update({ listName: "Inbox", name: "a", dueDate: "2026-12-12" });

    expect(scripts[0]).toContain("set day of theDueDate to 12");
    expect(scripts[0]).toContain("set allday due date to theDueDate");
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
