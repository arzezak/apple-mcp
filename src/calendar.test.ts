import { describe, expect, test } from "bun:test";
import { createCalendar } from "./calendar.ts";
import { recordingRun } from "./testing.ts";
import type { EventRange, EventRecord } from "./eventkit.ts";

async function createScript(
  input: Parameters<ReturnType<typeof createCalendar>["createEvent"]>[0],
) {
  const { run, scripts } = recordingRun("UID-1");
  const created = await createCalendar(run).createEvent(input);
  return { script: scripts[0]!, created };
}

describe("calendar.listEvents and searchEvents", () => {
  const NOW = new Date(2026, 10, 25, 15, 30);

  function eventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
    return {
      calendar: "Work",
      title: "Standup",
      start: new Date(2026, 10, 25, 9, 0),
      end: new Date(2026, 10, 25, 9, 30),
      location: "",
      id: "UID-1",
      ...overrides,
    };
  }

  function calendarWith(events: EventRecord[]) {
    const ranges: EventRange[] = [];

    const calendar = createCalendar(recordingRun().run, {
      readEvents: async (range) => {
        ranges.push(range);
        return events;
      },
      now: () => NOW,
    });

    return { calendar, ranges };
  }

  test("formats one line per event, ending with its id", async () => {
    const { calendar } = calendarWith([eventRecord({ location: "Room 3" })]);

    const lines = await calendar.listEvents({ calendar: "Work" });

    expect(lines).toEqual([
      "Standup | Wednesday, November 25, 2026 at 9:00:00 AM → Wednesday, November 25, 2026 at 9:30:00 AM @ Room 3 | id: UID-1",
    ]);
  });

  test("leaves out the location when the event has none", async () => {
    const { calendar } = calendarWith([eventRecord()]);

    const lines = await calendar.listEvents({ calendar: "Work" });

    expect(lines[0]).toContain("9:30:00 AM | id: UID-1");
  });

  test("joins a multi-line title or location so each event stays on one line", async () => {
    const { calendar } = calendarWith([
      eventRecord({ title: "Lunch\nwith Sam", location: "Cabildo 1234\r\n  CABA" }),
    ]);

    const lines = await calendar.listEvents({ calendar: "Work" });

    expect(lines[0]).toStartWith("Lunch / with Sam | ");
    expect(lines[0]).toContain(" @ Cabildo 1234 / CABA | id: ");
  });

  test("reads today by default and prefixes calendar names when unscoped", async () => {
    const { calendar, ranges } = calendarWith([eventRecord({ calendar: "Home" })]);

    const lines = await calendar.listEvents({});

    expect(ranges).toEqual([
      {
        calendar: undefined,
        start: new Date(2026, 10, 25),
        end: new Date(2026, 10, 25, 23, 59, 59),
      },
    ]);

    expect(lines[0]).toStartWith("Home: Standup | ");
  });

  test("reads the named calendar over the days back and ahead", async () => {
    const { calendar, ranges } = calendarWith([]);

    await calendar.listEvents({ calendar: "Work", daysBack: 7, daysAhead: 3 });

    expect(ranges).toEqual([
      {
        calendar: "Work",
        start: new Date(2026, 10, 18),
        end: new Date(2026, 10, 27, 23, 59, 59),
      },
    ]);
  });

  test("sorts by start and drops events that began before the range", async () => {
    const { calendar } = calendarWith([
      eventRecord({ title: "Later", start: new Date(2026, 10, 25, 17, 0) }),
      eventRecord({ title: "Began yesterday", start: new Date(2026, 10, 24, 22, 0) }),
      eventRecord({ title: "Earlier", start: new Date(2026, 10, 25, 8, 0) }),
    ]);

    const lines = await calendar.listEvents({ calendar: "Work" });

    expect(lines.map((line) => line.split(" | ")[0])).toEqual(["Earlier", "Later"]);
  });

  test("search filters by title over 30 days by default, ignoring case", async () => {
    const { calendar, ranges } = calendarWith([
      eventRecord({ title: 'Daily stand "up"' }),
      eventRecord({ title: "Retro" }),
    ]);

    const lines = await calendar.searchEvents({ query: 'Stand "UP"', calendar: "Work" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith('Daily stand "up" | ');
    expect(ranges[0]!.end).toEqual(new Date(2026, 11, 24, 23, 59, 59));
  });
});

describe("calendar.updateEvent", () => {
  async function updateScript(
    input: Parameters<ReturnType<typeof createCalendar>["updateEvent"]>[0],
  ) {
    const { run, scripts } = recordingRun();
    await createCalendar(run).updateEvent(input);
    return scripts[0]!;
  }

  test("addresses the event by id directly and by title through a filter", async () => {
    expect(await updateScript({ calendar: "Home", id: "UID-1", newTitle: "x" })).toContain(
      'tell event id "UID-1"',
    );

    expect(await updateScript({ calendar: "Home", title: "Old", newTitle: "x" })).toContain(
      'tell first event whose summary is "Old"',
    );
  });

  test("checks existence and sets only the given text fields", async () => {
    const script = await updateScript({ calendar: "Home", id: "UID-1", location: "Room 3" });

    expect(script).toContain('if not (exists event id "UID-1") then error "No matching event."');
    expect(script).toContain('set location to "Room 3"');
    expect(script).not.toContain("set summary");
    expect(script).not.toContain("set start date");
  });

  test("startDate alone keeps the time of day and the duration", async () => {
    const script = await updateScript({ calendar: "Home", id: "UID-1", startDate: "2026-12-20" });

    expect(script).toContain("set month of theStart to 12");
    expect(script).toContain("set day of theStart to 20");
    expect(script).toContain("set theStart to theStart + (time of oldStart)");
    expect(script).toContain("set theEnd to theStart + (oldEnd - oldStart)");
    expect(script).toContain("if theStart < oldEnd then");
    expect(script).not.toContain("allday event");
  });

  test("hour and duration apply to a copy of the current start", async () => {
    const script = await updateScript({
      calendar: "Home",
      id: "UID-1",
      hour: 16,
      durationMinutes: 45,
    });

    expect(script).toContain("copy oldStart to theStart");
    expect(script).toContain("set hours of theStart to 16");
    expect(script).toContain("set theEnd to theStart + (45 * minutes)");
  });

  test("allDay spans the whole day and toggles the flag", async () => {
    const script = await updateScript({ calendar: "Home", id: "UID-1", allDay: true });

    expect(script).toContain("set theEnd to theStart + days - 1");
    expect(script).toContain("set allday event to true");
  });

  test("rejects an empty update and ambiguous matches before running anything", async () => {
    const { run, scripts } = recordingRun();
    const calendar = createCalendar(run);

    await expect(calendar.updateEvent({ calendar: "Home", id: "UID-1" })).rejects.toThrow(
      "Nothing to update",
    );

    await expect(
      calendar.updateEvent({ calendar: "Home", newTitle: "x" }),
    ).rejects.toThrow("exactly one");

    expect(scripts).toEqual([]);
  });
});

describe("calendar.deleteEvent", () => {
  test("deletes through the direct event id specifier", async () => {
    const { run, scripts } = recordingRun();
    await createCalendar(run).deleteEvent({ calendar: "Home", id: "UID-1" });

    expect(scripts[0]).toContain('if not (exists event id "UID-1") then error "No matching event."');
    expect(scripts[0]).toContain('delete event id "UID-1"');
    expect(scripts[0]).not.toContain("whose uid");
  });

  test("deletes the first event with an exact title", async () => {
    const { run, scripts } = recordingRun();
    await createCalendar(run).deleteEvent({ calendar: "Home", title: "Standup" });

    expect(scripts[0]).toContain('delete first event whose summary is "Standup"');
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

    expect(script).toContain("set month of theStart to 10");
    expect(script).toContain("set day of theStart to 1\nset time of theStart to 0");
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
