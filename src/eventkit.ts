import { SLOW_QUERY_TIMEOUT_MS, type RunScript } from "./osascript.ts";

const ENTITIES = {
  events: {
    type: 0,
    request: "requestFullAccessToEventsWithCompletion",
    denied:
      "osascript has no full Calendar access. Allow it under System Settings > Privacy & Security > Calendars.",
  },
  reminders: {
    type: 1,
    request: "requestFullAccessToRemindersWithCompletion",
    denied:
      "osascript has no Reminders access. Allow it under System Settings > Privacy & Security > Reminders.",
  },
} as const;

// The bridge returns the authorization status as a string, hence Number().
// The completion callback never fires under osascript, so the status is polled.
export function eventStoreStatements(entity: keyof typeof ENTITIES): string {
  const { type, request, denied } = ENTITIES[entity];

  return `ObjC.import("EventKit");
const store = $.EKEventStore.alloc.init;
const status = () => Number($.EKEventStore.authorizationStatusForEntityType(${type}));

if (status() === 0) {
  store.${request}(() => {});
  const deadline = Date.now() + 45000;

  while (status() === 0 && Date.now() < deadline)
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
}

if (status() !== 3) throw new Error(${JSON.stringify(denied)});`;
}

export type EventRecord = {
  calendar: string;
  title: string;
  start: Date;
  end: Date;
  location: string;
  id: string;
};

export type EventRange = { calendar?: string; start: Date; end: Date };

export type ReadEvents = (range: EventRange) => Promise<EventRecord[]>;

type EventRow = Omit<EventRecord, "start" | "end"> & { start: number; end: number };

function eventsScript({ calendar, start, end }: EventRange): string {
  return `${eventStoreStatements("events")}

const calendarName = ${JSON.stringify(calendar ?? null)};
let calendars = $();

if (calendarName !== null) {
  const namedCalendars = ObjC.unwrap(store.calendarsForEntityType(0)).filter(
    (candidate) => ObjC.unwrap(candidate.title) === calendarName,
  );

  if (namedCalendars.length === 0) throw new Error("No calendar named " + calendarName + ".");

  calendars = $(namedCalendars);
}

const predicate = store.predicateForEventsWithStartDateEndDateCalendars(new Date(${start.getTime()}), new Date(${end.getTime()}), calendars);
const text = (value) => ObjC.unwrap(value) || "";

JSON.stringify(
  (ObjC.unwrap(store.eventsMatchingPredicate(predicate)) || []).map((event) => ({
    calendar: text(event.calendar.title),
    title: text(event.title),
    start: ObjC.unwrap(event.startDate).getTime(),
    end: ObjC.unwrap(event.endDate).getTime(),
    location: text(event.location),
    id: text(event.calendarItemIdentifier),
  })),
);`;
}

// EventKit, not AppleScript: a whose filter reads every event of a calendar
// (176s across eleven calendars against 0.13s, 2026-11-25).
// calendarItemIdentifier is the uid that AppleScript's `event id` takes.
export function eventKitEvents(run: RunScript): ReadEvents {
  return async (range) => {
    const rows: EventRow[] = JSON.parse(
      await run(eventsScript(range), { timeoutMs: SLOW_QUERY_TIMEOUT_MS, language: "JavaScript" }),
    );

    return rows.map((row) => ({
      ...row,
      start: new Date(row.start),
      end: new Date(row.end),
    }));
  };
}
