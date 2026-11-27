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
// The access request's completion callback never fires under osascript, so
// the status is polled.
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

export type ReminderRecord = {
  list: string;
  name: string;
  notes: string;
  priority: number;
  due: Date | null;
  timed: boolean;
  completed: Date | null;
  id: string;
};

export type ReminderScope = { listName?: string; includeCompleted: boolean };

export type ReadReminders = (scope: ReminderScope) => Promise<ReminderRecord[]>;

type ReminderRow = Omit<ReminderRecord, "due" | "completed"> & {
  due: number | null;
  completed: number | null;
};

function remindersScript({ listName, includeCompleted }: ReminderScope): string {
  const predicate = includeCompleted
    ? "store.predicateForRemindersInCalendars(lists)"
    : "store.predicateForIncompleteRemindersWithDueDateStartingEndingCalendars($(), $(), lists)";

  return `${eventStoreStatements("reminders")}

const listName = ${JSON.stringify(listName ?? null)};
let lists = $();

if (listName !== null) {
  const namedLists = ObjC.unwrap(store.calendarsForEntityType(1)).filter(
    (candidate) => ObjC.unwrap(candidate.title) === listName,
  );

  if (namedLists.length === 0) throw new Error("No list named " + listName + ".");

  lists = $(namedLists);
}

let fetched = null;

store.fetchRemindersMatchingPredicateCompletion(${predicate}, (reminders) => {
  fetched = reminders;
});

const fetchDeadline = Date.now() + 30000;

while (fetched === null && Date.now() < fetchDeadline)
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));

if (fetched === null) throw new Error("Reminders did not return the reminders in time.");

const text = (value) => ObjC.unwrap(value) || "";

JSON.stringify(
  (ObjC.unwrap(fetched) || []).map((reminder) => {
    const due = reminder.dueDateComponents;
    const hasDue = !due.isNil();
    const completionDate = reminder.completionDate;

    return {
      list: text(reminder.calendar.title),
      name: text(reminder.title),
      notes: text(reminder.notes),
      priority: Number(reminder.priority),
      due: hasDue ? ObjC.unwrap($.NSCalendar.currentCalendar.dateFromComponents(due)).getTime() : null,
      timed: hasDue && Number(due.hour) < 24,
      completed: completionDate.isNil() ? null : ObjC.unwrap(completionDate).getTime(),
      id: "x-apple-reminder://" + text(reminder.calendarItemIdentifier),
    };
  }),
);`;
}

// An all-day due date has no hour component.
export function eventKitReminders(run: RunScript): ReadReminders {
  return async (scope) => {
    const rows: ReminderRow[] = JSON.parse(
      await run(remindersScript(scope), { timeoutMs: SLOW_QUERY_TIMEOUT_MS, language: "JavaScript" }),
    );

    return rows.map((row) => ({
      ...row,
      due: row.due === null ? null : new Date(row.due),
      completed: row.completed === null ? null : new Date(row.completed),
    }));
  };
}
