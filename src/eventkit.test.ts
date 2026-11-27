import { describe, expect, test } from "bun:test";
import { eventKitEvents, eventKitReminders, eventStoreStatements } from "./eventkit.ts";
import { recordingRun } from "./testing.ts";

describe("eventKitEvents", () => {
  const RANGE = { start: new Date(2026, 10, 25), end: new Date(2026, 10, 25, 23, 59, 59) };

  test("turns the rows the JXA script prints into event records", async () => {
    const row = {
      calendar: "Work",
      title: "Standup",
      start: new Date(2026, 10, 25, 9, 0).getTime(),
      end: new Date(2026, 10, 25, 9, 30).getTime(),
      location: "",
      id: "UID-1",
    };

    const { run, languages } = recordingRun(JSON.stringify([row]));

    const events = await eventKitEvents(run)(RANGE);

    expect(languages).toEqual(["JavaScript"]);

    expect(events).toEqual([
      {
        ...row,
        start: new Date(2026, 10, 25, 9, 0),
        end: new Date(2026, 10, 25, 9, 30),
      },
    ]);
  });

  test("passes the calendar name and the range to the script", async () => {
    const { run, scripts } = recordingRun("[]");

    await eventKitEvents(run)({ ...RANGE, calendar: 'Work "Office"' });

    expect(scripts[0]).toContain('const calendarName = "Work \\"Office\\"";');
    expect(scripts[0]).toContain(`new Date(${RANGE.start.getTime()}), new Date(${RANGE.end.getTime()})`);
  });
});

describe("eventKitReminders", () => {
  test("turns the rows the JXA script prints into reminder records", async () => {
    const row = {
      list: "Inbox",
      name: "Pay rent",
      notes: "",
      priority: 0,
      due: new Date(2026, 10, 26, 9, 30).getTime(),
      timed: true,
      completed: null,
      id: "x-apple-reminder://ABC",
    };

    const completedRow = {
      ...row,
      due: null,
      timed: false,
      completed: new Date(2026, 10, 27, 10, 51).getTime(),
    };

    const { run, languages } = recordingRun(JSON.stringify([row, completedRow]));

    const reminders = await eventKitReminders(run)({ includeCompleted: false });

    expect(languages).toEqual(["JavaScript"]);

    expect(reminders).toEqual([
      { ...row, due: new Date(2026, 10, 26, 9, 30) },
      { ...completedRow, completed: new Date(2026, 10, 27, 10, 51) },
    ]);
  });

  test("asks only for incomplete reminders unless completed ones are wanted", async () => {
    const { run, scripts } = recordingRun("[]");

    await eventKitReminders(run)({ listName: 'Home "base"', includeCompleted: false });
    await eventKitReminders(run)({ includeCompleted: true });

    expect(scripts[0]).toContain('const listName = "Home \\"base\\"";');
    expect(scripts[0]).toContain("predicateForIncompleteRemindersWithDueDateStartingEndingCalendars(");
    expect(scripts[1]).toContain("const listName = null;");
    expect(scripts[1]).toContain("store.predicateForRemindersInCalendars(lists)");
  });
});

describe("eventStoreStatements", () => {
  test("asks for access only when it was never decided, per entity", () => {
    const eventsStatements = eventStoreStatements("events");
    const remindersStatements = eventStoreStatements("reminders");

    expect(eventsStatements).toContain("authorizationStatusForEntityType(0)");
    expect(eventsStatements).toContain("if (status() === 0) {");
    expect(eventsStatements).toContain("store.requestFullAccessToEventsWithCompletion(");
    expect(remindersStatements).toContain("authorizationStatusForEntityType(1)");
    expect(remindersStatements).toContain("store.requestFullAccessToRemindersWithCompletion(");
  });
});
