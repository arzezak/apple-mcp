import { describe, expect, test } from "bun:test";
import { reminderCreateScript } from "./reminders.ts";

describe("reminderCreateScript", () => {
  test("uses all-day due dates for ISO date-only input", () => {
    const script = reminderCreateScript({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20",
      allDay: false,
    });

    expect(script).toContain(
      'allday due date:date "20 June 2026 at 12:00:00 AM"',
    );
    expect(script).not.toContain(", due date:");
  });

  test("uses timed due dates when the input includes a time", () => {
    const script = reminderCreateScript({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "2026-06-20 09:30:00",
      allDay: false,
    });

    expect(script).toContain(
      'due date:date "20 June 2026 at 9:30:00 AM"',
    );
    expect(script).not.toContain("allday due date:");
  });

  test("allDay forces the all-day due date property", () => {
    const script = reminderCreateScript({
      listName: "Inbox",
      name: "Test reminder",
      dueDate: "June 20, 2026 9:30 AM",
      allDay: true,
    });

    expect(script).toContain('allday due date:date "June 20, 2026 9:30 AM"');
    expect(script).not.toContain(", due date:");
  });

  test("escapes list, title, and notes", () => {
    const script = reminderCreateScript({
      listName: 'Inbox "Main"',
      name: 'Pay \\ "Bill"',
      notes: 'Use "checking"',
      allDay: false,
    });

    expect(script).toContain('list "Inbox \\"Main\\""');
    expect(script).toContain('name:"Pay \\\\ \\"Bill\\""');
    expect(script).toContain('body:"Use \\"checking\\""');
  });
});
