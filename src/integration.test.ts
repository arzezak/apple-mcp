import { beforeAll, describe, expect, test } from "bun:test";
import { esc, runAppleScript } from "./osascript.ts";
import { registerCalendarTools } from "./calendar.ts";
import { registerNotesTools } from "./notes.ts";
import { registerRemindersTools } from "./reminders.ts";

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

function cleanupScript(...names: string[]): string {
  return names
    .map((name) => `if ${name} is not missing value then delete ${name}`)
    .join("\n    ");
}

// Find-or-create fragments for the Test containers, shared by the identity
// tests and the tool-handler suite. Each leaves the container in `box`.
function ensureRemindersListScript(): string {
  return `try
    set box to list "${esc(TEST_CONTAINER_NAME)}"
  on error
    set box to make new list with properties {name:"${esc(TEST_CONTAINER_NAME)}"}
  end try`;
}

function ensureNotesFolderScript(): string {
  return `if "${esc(TEST_CONTAINER_NAME)}" is not in (name of every folder) then
    tell default account to make new folder with properties {name:"${esc(TEST_CONTAINER_NAME)}"}
  end if
  set box to folder "${esc(TEST_CONTAINER_NAME)}"`;
}

function ensureCalendarScript(): string {
  return `if "${esc(TEST_CONTAINER_NAME)}" is not in (name of every calendar) then
    make new calendar with properties {name:"${esc(TEST_CONTAINER_NAME)}"}
  end if
  set box to calendar "${esc(TEST_CONTAINER_NAME)}"`;
}

// Envelope shared by the identity tests: whatever was created in createdA and
// createdB is deleted on both the success and error paths, so test data never
// leaks into the real apps.
function withCleanup(body: string, returnExpression: string): string {
  return `set createdA to missing value
  set createdB to missing value
  try
    ${body}
    ${cleanupScript("createdA", "createdB")}
    return ${returnExpression}
  on error errMsg number errNum
    ${cleanupScript("createdA", "createdB")}
    error errMsg number errNum
  end try`;
}

function expectDifferentIds(first: string, second: string): void {
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first).not.toBe(second);
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

// ─── Identity tests ───────────────────────────────────────────────────────────

describeIntegration("Apple app identity integration", () => {
  test("Reminders exposes IDs and can disambiguate duplicate titles by body", async () => {
    const title = uniqueName("shared-reminder-title");
    const firstBody = uniqueName("body-a");
    const secondBody = uniqueName("body-b");

    const raw = await runAppleScript(`
tell application "Reminders"
  ${withCleanup(
    `${ensureRemindersListScript()}

    tell box
      set createdA to make new reminder with properties {name:"${esc(title)}", body:"${esc(firstBody)}"}
      set createdB to make new reminder with properties {name:"${esc(title)}", body:"${esc(secondBody)}"}
    end tell

    set boxId to id of box
    set valueA to id of createdA
    set valueB to id of createdB
    set lookupTitle to name of (first reminder of box whose id is valueB)
    set lookupId to id of (first reminder of box whose name is "${esc(title)}" and body is "${esc(secondBody)}")`,
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
    `${ensureNotesFolderScript()}

    tell box
      set createdA to make new note with properties {name:"${esc(title)}", body:"${esc(firstBody)}"}
      set createdB to make new note with properties {name:"${esc(title)}", body:"${esc(secondBody)}"}
    end tell

    set valueA to id of createdA
    set valueB to id of createdB
    set lookupTitle to name of (first note whose id is valueB)
    set lookupId to missing value
    repeat with candidate in every note of box
      if name of candidate is "${esc(title)}" and plaintext of candidate contains "${esc(secondMarker)}" then
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
    `${ensureCalendarScript()}

    tell box
      set createdA to make new event with properties {summary:"${esc(title)}", description:"${esc(firstDescription)}", start date:startsAtValue, end date:endsAtValue}
      set createdB to make new event with properties {summary:"${esc(title)}", description:"${esc(secondDescription)}", start date:startsAtValue, end date:endsAtValue}
    end tell

    set valueA to uid of createdA
    set valueB to uid of createdB
    set lookupTitle to summary of (first event of box whose uid is valueB)
    set lookupId to uid of (first event of box whose summary is "${esc(title)}" and description is "${esc(secondDescription)}")`,
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

// ─── Tool handler tests ───────────────────────────────────────────────────────

describeIntegration("Tool handlers", () => {
  let handlers: Map<string, Handler>;

  beforeAll(async () => {
    handlers = buildHandlers();

    // Ensure Test containers exist. The three apps are independent processes,
    // so spin up all three setup scripts concurrently.
    await Promise.all([
      runAppleScript(`tell application "Reminders"
  ${ensureRemindersListScript()}
end tell`),
      runAppleScript(`tell application "Notes"
  ${ensureNotesFolderScript()}
end tell`),
      runAppleScript(`tell application "Calendar"
  ${ensureCalendarScript()}
end tell`),
    ]);
  });

  // ── Read tools ──────────────────────────────────────────────────────────────

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

  test("reminders_search returns a JSON array", async () => {
    const text = await call(handlers, "reminders_search", {
      query: "a",
      includeCompleted: false,
    });
    expect(Array.isArray(JSON.parse(text))).toBe(true);
  }, 120_000);

  // ── Reminders write round-trip ───────────────────────────────────────────────

  test("reminders create / complete / delete round-trip", async () => {
    const name = uniqueName("reminder");

    await call(handlers, "reminders_create", {
      listName: TEST_CONTAINER_NAME,
      name,
      notes: "integration notes",
      dueDate: "2026-12-31 09:00:00",
      priority: 5,
    });

    const listed = await call(handlers, "reminders_list", {
      listName: TEST_CONTAINER_NAME,
      includeCompleted: false,
    });
    expect(listed).toContain(name);
    expect(listed).toContain("due:");

    await call(handlers, "reminders_complete", {
      listName: TEST_CONTAINER_NAME,
      name,
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

    const afterDelete = await call(handlers, "reminders_search", {
      query: name,
      includeCompleted: true,
    });
    expect(JSON.parse(afterDelete)).not.toContain(name);
  }, 120_000);

  // ── Notes write round-trip ───────────────────────────────────────────────────

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

  // ── Calendar write round-trip ─────────────────────────────────────────────────

  test("calendar create (timed + all-day) / list+search / delete round-trip", async () => {
    const timedTitle = uniqueName("event");
    const allDayTitle = uniqueName("allday");

    await call(handlers, "calendar_create_event", {
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

    const found = await call(handlers, "calendar_search_events", {
      query: timedTitle,
      calendar: TEST_CONTAINER_NAME,
      daysAhead: 3,
    });
    expect(found).toContain(timedTitle);

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
      title: timedTitle,
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
  });

  // Creates an every-four-month recurring event, reads its allday flag and
  // recurrence straight from Calendar, and always deletes the event.
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
  tell calendar "${esc(TEST_CONTAINER_NAME)}"
    set createdEvent to first event whose summary is "${esc(title)}"
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
        // Creation may have failed before there was anything to clean up.
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
});
