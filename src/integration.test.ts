import { beforeAll, describe, expect, test } from "bun:test";
import { quoted, runAppleScript } from "./osascript.ts";
import { registerCalendarTools } from "./calendar.tools.ts";
import { registerNotesTools } from "./notes.tools.ts";
import { registerRemindersTools } from "./reminders.tools.ts";

const describeIntegration =
  process.env.APPLE_MCP_INTEGRATION === "1" ? describe : describe.skip;

const TEST_CONTAINER_NAME = "Test";

type Handler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}>;

function buildHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();

  const captureServer = {
    registerTool: (name: string, _meta: unknown, handler: Handler) =>
      handlers.set(name, handler),
  } as any;

  registerCalendarTools(captureServer);
  registerNotesTools(captureServer);
  registerRemindersTools(captureServer);
  return handlers;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const CONTAINERS = {
  Reminders: { kind: "list", make: "" },
  Notes: { kind: "folder", make: "tell default account to " },
  Calendar: { kind: "calendar", make: "" },
} as const;

function ensureContainerScript(app: keyof typeof CONTAINERS): string {
  const { kind, make } = CONTAINERS[app];
  const name = quoted(TEST_CONTAINER_NAME);

  return `if ${name} is not in (name of every ${kind}) then
    ${make}make new ${kind} with properties {name:${name}}
  end if
  set box to ${kind} ${name}`;
}

const CLEANUP = `if createdA is not missing value then delete createdA
    if createdB is not missing value then delete createdB`;

function withCleanup(body: string, returnExpression: string): string {
  return `set createdA to missing value
  set createdB to missing value
  try
    ${body}
    ${CLEANUP}
    return ${returnExpression}
  on error errMsg number errNum
    ${CLEANUP}
    error errMsg number errNum
  end try`;
}

function expectDifferentIds(first: string, second: string): void {
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first).not.toBe(second);
}

function createdId(text: string, idPattern: RegExp): string {
  const match = new RegExp(`\\(id: (${idPattern.source})\\)\\.$`).exec(text);
  expect(match, text).not.toBeNull();
  return match![1];
}

function dateStamp(variable: string): string {
  return `((year of ${variable}) as text) & "-" & ((month of ${variable} as integer) as text) & "-" & ((day of ${variable}) as text) & " " & ((time of ${variable}) as text)`;
}

async function readReminder(id: string) {
  const raw = await runAppleScript(
    `tell application "Reminders" to tell list ${quoted(TEST_CONTAINER_NAME)}
  set r to first reminder whose id is ${quoted(id)}
  set d to due date of r
  return (name of r) & linefeed & (body of r) & linefeed & ((priority of r) as text) & linefeed & ${dateStamp("d")}
end tell`,
    60_000,
  );

  const [name, notes, priority, due] = raw.split("\n");
  return { name, notes, priority, due, timed: await reminderHasDueTime(id) };
}

// AppleScript's `allday due date` is set on timed reminders too, so only
// EventKit's due date components can tell the two apart.
async function reminderHasDueTime(id: string): Promise<boolean> {
  const uuid = id.replace("x-apple-reminder://", "");

  const raw = await runAppleScript(
    `ObjC.import("EventKit");
const store = $.EKEventStore.alloc.init;
String(Number(store.calendarItemWithIdentifier(${JSON.stringify(uuid)}).dueDateComponents.hour) < 24);`,
    60_000,
    "JavaScript",
  );

  return raw === "true";
}

async function readReminderRule(id: string) {
  const uuid = id.replace("x-apple-reminder://", "");

  const raw = await runAppleScript(
    `ObjC.import("EventKit");
const store = $.EKEventStore.alloc.init;
const rule = store.calendarItemWithIdentifier(${JSON.stringify(uuid)}).recurrenceRules.firstObject;
const end = rule.recurrenceEnd;
const hasEnd = !end.isNil();
JSON.stringify({
  frequency: Number(rule.frequency),
  interval: Number(rule.interval),
  count: hasEnd ? Number(end.occurrenceCount) : 0,
  until: hasEnd && !end.endDate.isNil() ? Number(end.endDate.timeIntervalSince1970) : null,
});`,
    60_000,
    "JavaScript",
  );

  return JSON.parse(raw);
}

async function readEvent(id: string) {
  const raw = await runAppleScript(
    `tell application "Calendar" to tell calendar ${quoted(TEST_CONTAINER_NAME)}
  set e to event id ${quoted(id)}
  set s to start date of e
  set f to end date of e
  return (summary of e) & linefeed & (location of e) & linefeed & (description of e) & linefeed & ((allday event of e) as text) & linefeed & ${dateStamp("s")} & linefeed & ${dateStamp("f")}
end tell`,
    60_000,
  );

  const [title, location, notes, allDay, start, end] = raw.split("\n");
  return { title, location, notes, allDay, start, end };
}

async function call(
  handlers: Map<string, Handler>,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler registered for "${name}"`);
  const result = await handler(input);
  return result.content[0].text;
}

describeIntegration("Apple app identity integration", () => {
  test("Reminders exposes IDs and can disambiguate duplicate titles by body", async () => {
    const title = uniqueName("shared-reminder-title");
    const firstBody = uniqueName("body-a");
    const secondBody = uniqueName("body-b");

    const raw = await runAppleScript(`
tell application "Reminders"
  ${withCleanup(
    `${ensureContainerScript("Reminders")}

    tell box
      set createdA to make new reminder with properties {name:${quoted(title)}, body:${quoted(firstBody)}}
      set createdB to make new reminder with properties {name:${quoted(title)}, body:${quoted(secondBody)}}
    end tell

    set boxId to id of box
    set valueA to id of createdA
    set valueB to id of createdB
    set lookupTitle to name of (first reminder of box whose id is valueB)
    set lookupId to id of (first reminder of box whose name is ${quoted(title)} and body is ${quoted(secondBody)})`,
    "boxId & linefeed & valueA & linefeed & valueB & linefeed & lookupTitle & linefeed & lookupId",
  )}
end tell`, 110_000);

    const [listId, firstId, secondId, foundByIdTitle, foundByTitleAndBodyId] =
      raw.split("\n");

    expect(listId).toBeTruthy();
    expectDifferentIds(firstId, secondId);
    expect(foundByIdTitle).toBe(title);
    expect(foundByTitleAndBodyId).toBe(secondId);
  }, 120_000);

  test("Notes exposes IDs and can disambiguate duplicate titles by plaintext body", async () => {
    const title = uniqueName("shared-note-title");
    const firstMarker = uniqueName("note-body-a");
    const secondMarker = uniqueName("note-body-b");
    const firstBody = `<h1>${title}</h1><p>${firstMarker}</p>`;
    const secondBody = `<h1>${title}</h1><p>${secondMarker}</p>`;

    const raw = await runAppleScript(`
tell application "Notes"
  ${withCleanup(
    `${ensureContainerScript("Notes")}

    tell box
      set createdA to make new note with properties {name:${quoted(title)}, body:${quoted(firstBody)}}
      set createdB to make new note with properties {name:${quoted(title)}, body:${quoted(secondBody)}}
    end tell

    set valueA to id of createdA
    set valueB to id of createdB
    set lookupTitle to name of (first note whose id is valueB)
    set lookupId to missing value
    repeat with candidate in every note of box
      if name of candidate is ${quoted(title)} and plaintext of candidate contains ${quoted(secondMarker)} then
        set lookupId to id of candidate
      end if
    end repeat`,
    "valueA & linefeed & valueB & linefeed & lookupTitle & linefeed & lookupId",
  )}
end tell`, 110_000);

    const [firstId, secondId, foundByIdTitle, foundByTitleAndBodyId] =
      raw.split("\n");

    expectDifferentIds(firstId, secondId);
    expect(foundByIdTitle).toBe(title);
    expect(foundByTitleAndBodyId).toBe(secondId);
  }, 120_000);

  test("Calendar exposes IDs and can disambiguate duplicate titles by description", async () => {
    const title = uniqueName("shared-event-title");
    const firstDescription = uniqueName("event-body-a");
    const secondDescription = uniqueName("event-body-b");

    const raw = await runAppleScript(`
set startsAtValue to current date
set startsAtValue to startsAtValue + (1 * days)
set seconds of startsAtValue to 0
set endsAtValue to startsAtValue + (30 * 60)

tell application "Calendar"
  ${withCleanup(
    `${ensureContainerScript("Calendar")}

    tell box
      set createdA to make new event with properties {summary:${quoted(title)}, description:${quoted(firstDescription)}, start date:startsAtValue, end date:endsAtValue}
      set createdB to make new event with properties {summary:${quoted(title)}, description:${quoted(secondDescription)}, start date:startsAtValue, end date:endsAtValue}
    end tell

    set valueA to uid of createdA
    set valueB to uid of createdB
    set lookupTitle to summary of (first event of box whose uid is valueB)
    set lookupId to uid of (first event of box whose summary is ${quoted(title)} and description is ${quoted(secondDescription)})`,
    "valueA & linefeed & valueB & linefeed & lookupTitle & linefeed & lookupId",
  )}
end tell`, 110_000);

    const [firstId, secondId, foundByIdTitle, foundByTitleAndBodyId] =
      raw.split("\n");

    expectDifferentIds(firstId, secondId);
    expect(foundByIdTitle).toBe(title);
    expect(foundByTitleAndBodyId).toBe(secondId);
  }, 120_000);
});

describeIntegration("Tool handlers", () => {
  let handlers: Map<string, Handler>;

  beforeAll(async () => {
    handlers = buildHandlers();

    await Promise.all(
      (Object.keys(CONTAINERS) as Array<keyof typeof CONTAINERS>).map((app) =>
        runAppleScript(`tell application "${app}"
  ${ensureContainerScript(app)}
end tell`),
      ),
    );
  });

  test("calendar_list_calendars returns a JSON array", async () => {
    const text = await call(handlers, "calendar_list_calendars", {});
    const list = JSON.parse(text);

    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  test("calendar_list_events returns events or empty message", async () => {
    const text = await call(handlers, "calendar_list_events", {
      calendar: TEST_CONTAINER_NAME,
      daysAhead: 7,
      daysBack: 0,
    });

    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  test("calendar_search_events returns results or empty message", async () => {
    const text = await call(handlers, "calendar_search_events", {
      query: "a",
      calendar: TEST_CONTAINER_NAME,
      daysAhead: 7,
    });

    expect(typeof text).toBe("string");
  });

  test("notes_list_folders returns a JSON array containing Test", async () => {
    const text = await call(handlers, "notes_list_folders", {});
    const list = JSON.parse(text);

    expect(list).toContain(TEST_CONTAINER_NAME);
  });

  test("notes_list returns notes or empty message", async () => {
    const text = await call(handlers, "notes_list", {
      folder: TEST_CONTAINER_NAME,
    });

    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  test("notes_search returns a JSON array", async () => {
    const text = await call(handlers, "notes_search", {
      query: "a",
      searchContent: false,
    });

    expect(Array.isArray(JSON.parse(text))).toBe(true);
  });

  test("reminders_list_lists returns a JSON array containing Test", async () => {
    const text = await call(handlers, "reminders_list_lists", {});
    const list = JSON.parse(text);

    expect(list).toContain(TEST_CONTAINER_NAME);
  });

  test("reminders_list returns reminders or empty message", async () => {
    const text = await call(handlers, "reminders_list", {
      listName: TEST_CONTAINER_NAME,
      includeCompleted: false,
    });

    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  test("reminders_search returns lines with list names and ids", async () => {
    const text = await call(handlers, "reminders_search", {
      query: "a",
      includeCompleted: false,
    });

    expect(typeof text).toBe("string");

    if (text !== "No reminders found.") {
      expect(text.split("\n")[0]).toMatch(/^.+: .+ \| id: x-apple-reminder:\/\//);
    }
  }, 120_000);

  test("delete tools fail when nothing matches", async () => {
    const missing = uniqueName("missing");

    await expect(
      call(handlers, "reminders_delete", { listName: TEST_CONTAINER_NAME, id: missing }),
    ).rejects.toThrow("No matching reminder");

    await expect(
      call(handlers, "calendar_delete_event", { calendar: TEST_CONTAINER_NAME, id: missing }),
    ).rejects.toThrow("No matching event");

    await expect(
      call(handlers, "notes_delete", { name: missing }),
    ).rejects.toThrow("No matching note");
  }, 15_000);

  test("reminders create / complete / delete round-trip", async () => {
    const name = uniqueName("reminder");

    const created = await call(handlers, "reminders_create", {
      listName: TEST_CONTAINER_NAME,
      name,
      notes: "integration notes",
      dueDate: "2026-12-31 09:00:00",
      priority: 5,
    });

    const id = createdId(created, /x-apple-reminder:\/\/[0-9A-F-]{36}/);

    expect(
      await runAppleScript(
        `tell application "Reminders" to tell list ${quoted(TEST_CONTAINER_NAME)} to name of (first reminder whose id is ${quoted(id)})`,
      ),
    ).toBe(name);

    const listed = await call(handlers, "reminders_list", {
      listName: TEST_CONTAINER_NAME,
      includeCompleted: false,
    });

    expect(listed).toContain(name);
    expect(listed).toContain("due:");

    await call(handlers, "reminders_complete", {
      listName: TEST_CONTAINER_NAME,
      id,
    });

    const withCompleted = await call(handlers, "reminders_list", {
      listName: TEST_CONTAINER_NAME,
      includeCompleted: true,
    });

    expect(withCompleted).toContain(name);

    await call(handlers, "reminders_delete", {
      listName: TEST_CONTAINER_NAME,
      name,
    });

    const afterDelete = await call(handlers, "reminders_list", {
      listName: TEST_CONTAINER_NAME,
      includeCompleted: true,
    });

    expect(afterDelete).not.toContain(name);
  }, 15_000);

  test("notes create / edit / move / delete round-trip with markdown conversion", async () => {
    const title = uniqueName("note");
    const renamed = `${title}-renamed`;

    await call(handlers, "notes_create", {
      title,
      body: "# Heading\n- bullet **bold**",
      folder: TEST_CONTAINER_NAME,
    });

    const html = await call(handlers, "notes_read", { name: title, html: true });

    // Notes rewrites <h1>/<h2> into styled spans on storage; assert on text
    // content and the inline formatting tags that do survive.
    expect(html).toContain("Heading");
    expect(html).toContain("<b>bold</b>");

    await call(handlers, "notes_edit", {
      name: title,
      title: renamed,
      body: "## Updated",
    });

    const editedHtml = await call(handlers, "notes_read", {
      name: renamed,
      html: true,
    });

    expect(editedHtml).toContain("Updated");

    await call(handlers, "notes_move", {
      name: renamed,
      targetFolder: TEST_CONTAINER_NAME,
    });

    await call(handlers, "notes_delete", { name: renamed });

    const afterDelete = await call(handlers, "notes_search", {
      query: renamed,
      searchContent: false,
      folder: TEST_CONTAINER_NAME,
    });

    expect(JSON.parse(afterDelete)).not.toContain(renamed);
  });

  test("calendar create (timed + all-day) / list+search / delete round-trip", async () => {
    const timedTitle = uniqueName("event");
    const allDayTitle = uniqueName("allday");

    const created = await call(handlers, "calendar_create_event", {
      calendar: TEST_CONTAINER_NAME,
      title: timedTitle,
      daysFromNow: 1,
      hour: 12,
      minute: 30,
      durationMinutes: 45,
      location: "Integration Ave",
      notes: "integration test",
      allDay: false,
    });

    const uid = createdId(created, /[0-9A-F-]{36}/);

    expect(
      await runAppleScript(
        `tell application "Calendar" to tell calendar ${quoted(TEST_CONTAINER_NAME)} to summary of (first event whose uid is ${quoted(uid)})`,
      ),
    ).toBe(timedTitle);

    const found = await call(handlers, "calendar_search_events", {
      query: timedTitle,
      calendar: TEST_CONTAINER_NAME,
      daysAhead: 3,
    });

    expect(found).toContain(timedTitle);
    expect(found).toContain(" @ Integration Ave");

    await call(handlers, "calendar_create_event", {
      calendar: TEST_CONTAINER_NAME,
      title: allDayTitle,
      daysFromNow: 1,
      hour: 0,
      minute: 0,
      durationMinutes: 60,
      allDay: true,
    });

    const listed = await call(handlers, "calendar_list_events", {
      calendar: TEST_CONTAINER_NAME,
      daysAhead: 3,
      daysBack: 0,
    });

    expect(listed).toContain(timedTitle);
    expect(listed).toContain(allDayTitle);

    await call(handlers, "calendar_delete_event", {
      calendar: TEST_CONTAINER_NAME,
      id: uid,
    });

    await call(handlers, "calendar_delete_event", {
      calendar: TEST_CONTAINER_NAME,
      title: allDayTitle,
    });

    const afterDelete = await call(handlers, "calendar_search_events", {
      query: timedTitle,
      calendar: TEST_CONTAINER_NAME,
      daysAhead: 3,
    });

    expect(afterDelete).not.toContain(timedTitle);
  }, 15_000);

  async function roundTripRecurringEvent(
    title: string,
    overrides: Record<string, unknown>,
  ): Promise<{ allDay: string; recurrence: string }> {
    try {
      await call(handlers, "calendar_create_event", {
        calendar: TEST_CONTAINER_NAME,
        title,
        startDate: "2026-10-01",
        daysFromNow: 0,
        hour: 9,
        minute: 0,
        durationMinutes: 30,
        recurrence: {
          frequency: "monthly",
          interval: 4,
        },
        ...overrides,
      });

      const raw = await runAppleScript(`
tell application "Calendar"
  tell calendar ${quoted(TEST_CONTAINER_NAME)}
    set createdEvent to first event whose summary is ${quoted(title)}
    return (allday event of createdEvent as text) & linefeed & (recurrence of createdEvent as text)
  end tell
end tell`);

      const [allDay, recurrence] = raw.split("\n");
      return { allDay, recurrence };
    } finally {
      try {
        await call(handlers, "calendar_delete_event", {
          calendar: TEST_CONTAINER_NAME,
          title,
        });
      } catch {
      }
    }
  }

  function expectIndefiniteEveryFourMonths(recurrence: string): void {
    expect(recurrence).toContain("FREQ=MONTHLY");
    expect(recurrence).toContain("INTERVAL=4");
    expect(recurrence).not.toContain("COUNT=");
    expect(recurrence).not.toContain("UNTIL=");
  }

  test("calendar creates an indefinite every-four-month recurrence", async () => {
    const { recurrence } = await roundTripRecurringEvent(
      uniqueName("recurring-event"),
      {},
    );

    expectIndefiniteEveryFourMonths(recurrence);
  });

  test("calendar creates an all-day indefinite every-four-month recurrence", async () => {
    const { allDay, recurrence } = await roundTripRecurringEvent(
      uniqueName("recurring-allday-event"),
      { hour: 0, durationMinutes: 60, allDay: true },
    );

    expect(allDay).toBe("true");
    expectIndefiniteEveryFourMonths(recurrence);
  });

  async function withReminder(
    overrides: Record<string, unknown>,
    body: (id: string, name: string, created: string) => Promise<void>,
  ): Promise<void> {
    const name = uniqueName("reminder");

    const created = await call(handlers, "reminders_create", {
      listName: TEST_CONTAINER_NAME,
      name,
      ...overrides,
    });

    const id = createdId(created, /x-apple-reminder:\/\/[0-9A-F-]{36}/);

    try {
      await body(id, name, created);
    } finally {
      await call(handlers, "reminders_delete", { listName: TEST_CONTAINER_NAME, id });
    }
  }

  test("reminders_update changes the reminder by id and by name", async () => {
    await withReminder(
      { notes: "before", dueDate: "2027-01-15 09:00:00", priority: 5 },
      async (id, name) => {
        const renamed = `${name}-renamed`;

        await call(handlers, "reminders_update", {
          listName: TEST_CONTAINER_NAME,
          id,
          title: renamed,
          notes: "after",
          dueDate: "2027-02-20 14:30:00",
          priority: 1,
        });

        expect(await readReminder(id)).toEqual({
          name: renamed,
          notes: "after",
          priority: "1",
          due: "2027-2-20 52200",
          timed: true,
        });

        await call(handlers, "reminders_update", {
          listName: TEST_CONTAINER_NAME,
          name: renamed,
          dueDate: "2027-03-05",
        });

        expect(await readReminder(id)).toEqual({
          name: renamed,
          notes: "after",
          priority: "1",
          due: "2027-3-5 0",
          timed: false,
        });

        await expect(
          call(handlers, "reminders_update", {
            listName: TEST_CONTAINER_NAME,
            name: uniqueName("missing"),
            notes: "unused",
          }),
        ).rejects.toThrow("No matching reminder");
      },
    );
  }, 180_000);

  test("reminders_create attaches an indefinite recurrence", async () => {
    await withReminder(
      {
        dueDate: "2027-01-15 09:00:00",
        recurrence: { frequency: "monthly", interval: 2 },
      },
      async (id, _name, created) => {
        expect(created).toContain("FREQ=MONTHLY;INTERVAL=2");

        expect(await readReminderRule(id)).toEqual({
          frequency: 2,
          interval: 2,
          count: 0,
          until: null,
        });
      },
    );
  }, 120_000);

  test("reminders_create attaches a recurrence that ends after a count", async () => {
    await withReminder(
      {
        dueDate: "2027-01-15 09:00:00",
        recurrence: { frequency: "weekly", interval: 1, count: 5 },
      },
      async (id) => {
        expect(await readReminderRule(id)).toEqual({
          frequency: 1,
          interval: 1,
          count: 5,
          until: null,
        });
      },
    );
  }, 120_000);

  test("reminders_create attaches a recurrence that ends on a date", async () => {
    const until = "2027-06-01T12:00:00Z";

    await withReminder(
      {
        dueDate: "2027-01-15 09:00:00",
        recurrence: { frequency: "daily", interval: 3, until },
      },
      async (id) => {
        expect(await readReminderRule(id)).toEqual({
          frequency: 0,
          interval: 3,
          count: 0,
          until: new Date(until).getTime() / 1000,
        });
      },
    );
  }, 120_000);

  async function withEvent(
    body: (id: string, title: string) => Promise<void>,
  ): Promise<void> {
    const title = uniqueName("update-event");

    const created = await call(handlers, "calendar_create_event", {
      calendar: TEST_CONTAINER_NAME,
      title,
      startDate: "2027-03-10",
      daysFromNow: 0,
      hour: 14,
      minute: 30,
      durationMinutes: 45,
      location: "Before Ave",
      notes: "before",
      allDay: false,
    });

    const id = createdId(created, /[0-9A-F-]{36}/);

    try {
      await body(id, title);
    } finally {
      await call(handlers, "calendar_delete_event", {
        calendar: TEST_CONTAINER_NAME,
        id,
      });
    }
  }

  const update = (input: Record<string, unknown>) =>
    call(handlers, "calendar_update_event", {
      calendar: TEST_CONTAINER_NAME,
      ...input,
    });

  test("calendar_update_event changes text fields by id and by title", async () => {
    await withEvent(async (id, title) => {
      const renamed = `${title}-renamed`;

      await update({ id, newTitle: renamed, location: "After Ave" });

      expect(await readEvent(id)).toEqual({
        title: renamed,
        location: "After Ave",
        notes: "before",
        allDay: "false",
        start: "2027-3-10 52200",
        end: "2027-3-10 54900",
      });

      await update({ title: renamed, notes: "after" });
      expect((await readEvent(id)).notes).toBe("after");

      await expect(
        update({ title: uniqueName("missing"), notes: "unused" }),
      ).rejects.toThrow("No matching event");
    });
  }, 180_000);

  test("calendar_update_event startDate moves later and earlier, keeping time and duration", async () => {
    await withEvent(async (id) => {
      await update({ id, startDate: "2027-03-20" });
      let event = await readEvent(id);
      expect(event.start).toBe("2027-3-20 52200");
      expect(event.end).toBe("2027-3-20 54900");

      await update({ id, startDate: "2027-03-05" });
      event = await readEvent(id);
      expect(event.start).toBe("2027-3-5 52200");
      expect(event.end).toBe("2027-3-5 54900");
    });
  }, 180_000);

  test("calendar_update_event hour and duration reschedule within the day", async () => {
    await withEvent(async (id) => {
      await update({ id, hour: 20, minute: 15 });
      let event = await readEvent(id);
      expect(event.start).toBe("2027-3-10 72900");
      expect(event.end).toBe("2027-3-10 75600");

      await update({ id, hour: 8, durationMinutes: 90 });
      event = await readEvent(id);
      expect(event.start).toBe("2027-3-10 28800");
      expect(event.end).toBe("2027-3-10 34200");
    });
  }, 180_000);

  test("calendar_update_event toggles all-day on and off", async () => {
    await withEvent(async (id) => {
      await update({ id, allDay: true });
      let event = await readEvent(id);
      expect(event.allDay).toBe("true");
      expect(event.start).toBe("2027-3-10 0");

      await update({ id, allDay: false, hour: 9, durationMinutes: 30 });
      event = await readEvent(id);
      expect(event.allDay).toBe("false");
      expect(event.start).toBe("2027-3-10 32400");
      expect(event.end).toBe("2027-3-10 34200");
    });
  }, 180_000);
});
