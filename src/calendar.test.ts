import { describe, expect, test } from "bun:test";
import { createCalendar } from "./calendar.ts";
import { recordingRun } from "./testing.ts";

async function createScript(
  input: Parameters<ReturnType<typeof createCalendar>["createEvent"]>[0],
) {
  const { run, scripts } = recordingRun("UID-1");
  const created = await createCalendar(run).createEvent(input);
  return { script: scripts[0]!, created };
}

describe("calendar.listEvents and searchEvents", () => {
  test("appends the location only when the event has one", async () => {
    const { run, scripts } = recordingRun();
    await createCalendar(run).listEvents({ calendar: "Work" });

    expect(scripts[0]).toContain("set loc to location of r");
    expect(scripts[0]).toContain(
      'if loc is not missing value and loc is not "" then set eventLine to eventLine & " @ " & loc',
    );
    expect(scripts[0]).toContain('set eventLine to eventLine & " | id: " & uid of r');
    expect(scripts[0]).toContain("set end of outputLines to eventLine");
  });

  test("defaults to today and prefixes calendar names when unscoped", async () => {
    const { run, scripts } = recordingRun("Work: a\nHome: b");
    const lines = await createCalendar(run).listEvents({});

    expect(lines).toEqual(["Work: a", "Home: b"]);
    expect(scripts[0]).toContain("theStart + (1 * days) - 1");
    expect(scripts[0]).toContain("every calendar");
    expect(scripts[0]).toContain("set calName to name of cal");
  });

  test("search filters by summary over 30 days by default", async () => {
    const { run, scripts } = recordingRun();
    await createCalendar(run).searchEvents({ query: 'Stand "up"', calendar: "Work" });

    expect(scripts[0]).toContain('summary contains "Stand \\"up\\""');
    expect(scripts[0]).toContain("theStart + (30 * days) - 1");
    expect(scripts[0]).toContain('{calendar "Work"}');
  });
});

describe("calendar.createEvent", () => {
  test("returns the uid from the script", async () => {
    const { created } = await createScript({ calendar: "Home", title: "x", hour: 9 });
    expect(created).toEqual({ id: "UID-1", recurrenceRule: undefined });
  });

  test("all-day events end on the same day", async () => {
    const { script } = await createScript({
      calendar: "Home",
      title: "Trip",
      daysFromNow: 3,
      hour: 0,
      allDay: true,
    });

    expect(script).toContain("set theEnd to theStart + days - 1");
    expect(script).toContain(
      "set createdEvent to make new event with properties {start date:theStart, end date:theEnd, summary:",
    );
    expect(script).toContain("allday event:true");
    expect(script).toContain("return uid of createdEvent");
  });

  test("all-day events ignore provided hour and minute values", async () => {
    const { script } = await createScript({
      calendar: "Home",
      title: "Holiday",
      hour: 14,
      minute: 45,
      allDay: true,
    });

    expect(script).toContain("set hours of theStart to 0");
    expect(script).toContain("set minutes of theStart to 0");
    expect(script).not.toContain("set hours of theStart to 14");
    expect(script).not.toContain("set minutes of theStart to 45");
  });

  test("escapes special characters in title and location", async () => {
    const { script } = await createScript({
      calendar: 'Work "Office"',
      title: 'Meeting \\ "Room"',
      hour: 9,
      location: 'Floor "3"',
    });

    expect(script).toContain('summary:"Meeting \\\\ \\"Room\\""');
    expect(script).toContain('location:"Floor \\"3\\""');
    expect(script).toContain('calendar "Work \\"Office\\""');
  });

  test("timed events keep duration-based end dates", async () => {
    const { script } = await createScript({
      calendar: "Work",
      title: "Standup",
      daysFromNow: 1,
      hour: 9,
      minute: 30,
      durationMinutes: 45,
    });

    expect(script).toContain("set hours of theStart to 9");
    expect(script).toContain("set minutes of theStart to 30");
    expect(script).toContain("set theEnd to theStart + (45 * minutes)");
    expect(script).not.toContain("allday event:true");
    expect(script).not.toContain("recurrence:");
  });

  test("startDate uses a specific calendar date instead of daysFromNow", async () => {
    const { script } = await createScript({
      calendar: "Home",
      title: "Specific date",
      startDate: "2026-10-01",
      daysFromNow: 99,
      hour: 9,
      minute: 15,
    });

    expect(script).toContain('set theStart to date "1 October 2026 12:00:00 AM"');
    expect(script).not.toContain("set theStart to current date");
    expect(script).not.toContain("99 * days");
    expect(script).toContain("set hours of theStart to 9");
    expect(script).toContain("set minutes of theStart to 15");
  });

  test("monthly recurrence with interval repeats indefinitely by default", async () => {
    const { script, created } = await createScript({
      calendar: "Home",
      title: "Quarterly-ish check",
      startDate: "2026-10-01",
      hour: 10,
      durationMinutes: 30,
      recurrence: { frequency: "monthly", interval: 4 },
    });

    expect(created.recurrenceRule).toBe("FREQ=MONTHLY;INTERVAL=4");
    expect(script).toContain('recurrence:"FREQ=MONTHLY;INTERVAL=4"');
    expect(script).not.toContain("COUNT=");
    expect(script).not.toContain("UNTIL=");
  });

  test("recurrence can end after a count", async () => {
    const { created } = await createScript({
      calendar: "Home",
      title: "x",
      hour: 9,
      recurrence: { frequency: "weekly", interval: 2, count: 6 },
    });
    expect(created.recurrenceRule).toBe("FREQ=WEEKLY;INTERVAL=2;COUNT=6");
  });

  test("recurrence can end at an ISO until date", async () => {
    const { created } = await createScript({
      calendar: "Home",
      title: "x",
      hour: 9,
      recurrence: { frequency: "yearly", interval: 1, until: "2027-01-15T12:30:00Z" },
    });
    expect(created.recurrenceRule).toBe("FREQ=YEARLY;INTERVAL=1;UNTIL=20270115T123000Z");
  });

  test("recurrence rejects invalid end conditions", async () => {
    await expect(
      createScript({
        calendar: "Home",
        title: "x",
        hour: 9,
        recurrence: { frequency: "daily", interval: 0 },
      }),
    ).rejects.toThrow("Recurrence interval must be a positive integer.");

    await expect(
      createScript({
        calendar: "Home",
        title: "x",
        hour: 9,
        recurrence: { frequency: "daily", interval: 1, count: 2, until: "2027-01-15" },
      }),
    ).rejects.toThrow("Recurrence can end with count or until, not both.");
  });
});
