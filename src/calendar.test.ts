import { describe, expect, test } from "bun:test";
import {
  calendarCreateEventScript,
  calendarRecurrenceRule,
} from "./calendar.ts";

describe("calendarCreateEventScript", () => {
  test("all-day events end on the same day", () => {
    const script = calendarCreateEventScript({
      calendar: "Home",
      title: "Trip",
      daysFromNow: 3,
      hour: 0,
      minute: 0,
      durationMinutes: 60,
      allDay: true,
    });

    expect(script).toContain("set theEnd to theStart + days - 1");
    expect(script).toContain(
      "make new event with properties {start date:theStart, end date:theEnd, summary:",
    );
    expect(script).toContain("allday event:true");
  });

  test("all-day events ignore provided hour and minute values", () => {
    const script = calendarCreateEventScript({
      calendar: "Home",
      title: "Holiday",
      daysFromNow: 0,
      hour: 14,
      minute: 45,
      durationMinutes: 60,
      allDay: true,
    });

    expect(script).toContain("set hours of theStart to 0");
    expect(script).toContain("set minutes of theStart to 0");
    expect(script).not.toContain("set hours of theStart to 14");
    expect(script).not.toContain("set minutes of theStart to 45");
  });

  test("escapes special characters in title and location", () => {
    const script = calendarCreateEventScript({
      calendar: 'Work "Office"',
      title: 'Meeting \\ "Room"',
      daysFromNow: 0,
      hour: 9,
      minute: 0,
      durationMinutes: 60,
      location: 'Floor "3"',
      allDay: false,
    });

    expect(script).toContain('summary:"Meeting \\\\ \\"Room\\""');
    expect(script).toContain('location:"Floor \\"3\\""');
    expect(script).toContain('calendar "Work \\"Office\\""');
  });

  test("timed events keep duration-based end dates", () => {
    const script = calendarCreateEventScript({
      calendar: "Work",
      title: "Standup",
      daysFromNow: 1,
      hour: 9,
      minute: 30,
      durationMinutes: 45,
      allDay: false,
    });

    expect(script).toContain("set hours of theStart to 9");
    expect(script).toContain("set minutes of theStart to 30");
    expect(script).toContain("set theEnd to theStart + (45 * minutes)");
    expect(script).not.toContain("allday event:true");
    expect(script).not.toContain("recurrence:");
  });

  test("startDate uses a specific calendar date instead of daysFromNow", () => {
    const script = calendarCreateEventScript({
      calendar: "Home",
      title: "Specific date",
      startDate: "2026-10-01",
      daysFromNow: 99,
      hour: 9,
      minute: 15,
      durationMinutes: 60,
      allDay: false,
    });

    expect(script).toContain(
      'set theStart to date "1 October 2026 at 12:00:00 AM"',
    );
    expect(script).not.toContain("set theStart to current date");
    expect(script).not.toContain("99 * days");
    expect(script).toContain("set hours of theStart to 9");
    expect(script).toContain("set minutes of theStart to 15");
  });

  test("monthly recurrence with interval repeats indefinitely by default", () => {
    const script = calendarCreateEventScript({
      calendar: "Home",
      title: "Quarterly-ish check",
      startDate: "2026-10-01",
      daysFromNow: 0,
      hour: 10,
      minute: 0,
      durationMinutes: 30,
      allDay: false,
      recurrence: {
        frequency: "monthly",
        interval: 4,
      },
    });

    expect(script).toContain('recurrence:"FREQ=MONTHLY;INTERVAL=4"');
    expect(script).not.toContain("COUNT=");
    expect(script).not.toContain("UNTIL=");
  });

  test("recurrence can end after a count", () => {
    expect(
      calendarRecurrenceRule({
        frequency: "weekly",
        interval: 2,
        count: 6,
      }),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;COUNT=6");
  });

  test("recurrence can end at an ISO until date", () => {
    expect(
      calendarRecurrenceRule({
        frequency: "yearly",
        interval: 1,
        until: "2027-01-15T12:30:00Z",
      }),
    ).toBe("FREQ=YEARLY;INTERVAL=1;UNTIL=20270115T123000Z");
  });

  test("recurrence rejects invalid end conditions", () => {
    expect(() =>
      calendarRecurrenceRule({
        frequency: "daily",
        interval: 0,
      }),
    ).toThrow("Recurrence interval must be a positive integer.");

    expect(() =>
      calendarRecurrenceRule({
        frequency: "daily",
        interval: 1,
        count: 2,
        until: "2027-01-15",
      }),
    ).toThrow("Recurrence can end with count or until, not both.");
  });
});
