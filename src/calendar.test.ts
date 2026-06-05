import { describe, expect, test } from "bun:test";
import { calendarCreateEventScript } from "./calendar.ts";

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

    expect(script).toContain("set theEnd to theDate + days - 1");
    expect(script).toContain(
      "make new event with properties {start date:theDate, end date:theEnd, summary:",
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

    expect(script).toContain("set hours of theDate to 0");
    expect(script).toContain("set minutes of theDate to 0");
    expect(script).not.toContain("14");
    expect(script).not.toContain("45");
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
  });
});
