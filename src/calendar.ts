import {
  runAppleScript,
  quoted,
  SLOW_QUERY_TIMEOUT_MS,
  type RunScript,
} from "./osascript.ts";
import { runNameList, singleLine } from "./lists.ts";
import { appleScriptDateStatements, formatDateTime } from "./dates.ts";
import { eventSpecifier, requireEvent } from "./matching.ts";
import { recurrenceRule } from "./recurrence.ts";
import { eventKitEvents, type EventRecord, type ReadEvents } from "./eventkit.ts";
import type {
  CreateEventInput,
  EventChanges,
  EventMatch,
  ListEventsInput,
  SearchEventsInput,
  UpdateEventInput,
} from "./calendar.inputs.ts";

function setTimeOfDay(varName: string, hour = 0, minute = 0): string {
  return `set hours of ${varName} to ${hour}
set minutes of ${varName} to ${minute}
set seconds of ${varName} to 0`;
}

function eventLine(event: EventRecord, withCalendar: boolean): string {
  const prefix = withCalendar ? `${event.calendar}: ` : "";
  const location = singleLine(event.location);
  const place = location ? ` @ ${location}` : "";

  return `${prefix}${singleLine(event.title)} | ${formatDateTime(event.start)} → ${formatDateTime(event.end)}${place} | id: ${event.id}`;
}

function calendarCreateEventScript({
  calendar,
  title,
  startDate,
  daysFromNow = 0,
  hour,
  minute = 0,
  durationMinutes = 60,
  location,
  notes,
  allDay = false,
  recurrenceRule,
}: Omit<CreateEventInput, "recurrence"> & { recurrenceRule?: string }): string {
  const properties: string[] = [`summary:${quoted(title)}`];
  if (location) properties.push(`location:${quoted(location)}`);
  if (notes) properties.push(`description:${quoted(notes)}`);
  if (allDay) properties.push("allday event:true");
  if (recurrenceRule) properties.push(`recurrence:${quoted(recurrenceRule)}`);

  const dateSetup = allDay
    ? `${setTimeOfDay("theStart")}
set theEnd to theStart + days - 1`
    : `${setTimeOfDay("theStart", hour, minute)}
set theEnd to theStart + (${durationMinutes} * minutes)`;

  const startSetup = startDate
    ? appleScriptDateStatements("theStart", startDate)
    : `set theStart to current date
set theStart to theStart + (${daysFromNow} * days)`;

  return `
${startSetup}
${dateSetup}
tell application "Calendar"
  tell calendar ${quoted(calendar)}
    set createdEvent to make new event with properties {start date:theStart, end date:theEnd, ${properties.join(", ")}}
    return uid of createdEvent
  end tell
end tell`;
}

// Every `set` saves at once and Calendar rejects a start on or after the end,
// so the order of the two date sets depends on the direction of the move.
// `copy`, not `set`: AppleScript dates are shared by reference, so setting
// hours on an alias of oldStart would also move oldStart.
function eventRescheduleStatements({
  startDate,
  hour,
  minute = 0,
  durationMinutes,
  allDay,
}: EventChanges): string {
  const lines = [
    "set oldStart to get start date",
    "set oldEnd to get end date",
    startDate
      ? appleScriptDateStatements("theStart", startDate)
      : "copy oldStart to theStart",
  ];

  if (allDay === true) lines.push(setTimeOfDay("theStart"));
  else if (hour !== undefined) lines.push(setTimeOfDay("theStart", hour, minute));
  else if (startDate) lines.push("set theStart to theStart + (time of oldStart)");

  if (allDay === true) lines.push("set theEnd to theStart + days - 1");
  else if (durationMinutes !== undefined)
    lines.push(`set theEnd to theStart + (${durationMinutes} * minutes)`);
  else lines.push("set theEnd to theStart + (oldEnd - oldStart)");

  if (allDay !== undefined) lines.push(`set allday event to ${allDay}`);

  lines.push(`if theStart < oldEnd then
      set start date to theStart
      set end date to theEnd
    else
      set end date to theEnd
      set start date to theStart
    end if`);

  return lines.join("\n    ");
}

function calendarUpdateEventScript(
  calendar: string,
  specifier: string,
  changes: EventChanges,
): string {
  const { newTitle, location, notes } = changes;
  const sets: string[] = [];
  if (newTitle !== undefined) sets.push(`set summary to ${quoted(newTitle)}`);
  if (location !== undefined) sets.push(`set location to ${quoted(location)}`);
  if (notes !== undefined) sets.push(`set description to ${quoted(notes)}`);

  const reschedules =
    changes.startDate !== undefined ||
    changes.hour !== undefined ||
    changes.minute !== undefined ||
    changes.durationMinutes !== undefined ||
    changes.allDay !== undefined;

  if (reschedules) sets.push(eventRescheduleStatements(changes));

  if (sets.length === 0) {
    throw new Error(
      "Nothing to update. Provide newTitle, location, notes, or a new date/time.",
    );
  }

  return `tell application "Calendar" to tell calendar ${quoted(calendar)}
  ${requireEvent(specifier)}
  tell ${specifier}
    ${sets.join("\n    ")}
  end tell
end tell`;
}

export type Calendar = {
  listCalendars(): Promise<string[]>;
  listEvents(input: ListEventsInput): Promise<string[]>;
  searchEvents(input: SearchEventsInput): Promise<string[]>;
  createEvent(input: CreateEventInput): Promise<{ id: string; recurrenceRule?: string }>;
  updateEvent(input: UpdateEventInput): Promise<void>;
  deleteEvent(match: EventMatch): Promise<void>;
};

export function createCalendar(
  run: RunScript = runAppleScript,
  {
    readEvents = eventKitEvents(run),
    now = () => new Date(),
  }: { readEvents?: ReadEvents; now?: () => Date } = {},
): Calendar {
  async function eventLines({
    calendar,
    daysBack,
    daysAhead,
    query,
  }: {
    calendar?: string;
    daysBack: number;
    daysAhead: number;
    query?: string;
  }): Promise<string[]> {
    const today = now();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead, 0, 0, -1);
    const loweredQuery = query?.toLowerCase();
    const events = await readEvents({ calendar, start, end });

    return events
      .filter((event) => event.start >= start)
      .filter(
        (event) =>
          loweredQuery === undefined ||
          singleLine(event.title).toLowerCase().includes(loweredQuery),
      )
      .sort((first, second) => first.start.getTime() - second.start.getTime())
      .map((event) => eventLine(event, calendar === undefined));
  }

  return {
    listCalendars: () => runNameList(run, "Calendar", "name of every calendar"),

    listEvents: ({ calendar, daysAhead = 1, daysBack = 0 }) =>
      eventLines({ calendar, daysBack, daysAhead }),

    searchEvents: ({ query, calendar, daysAhead = 30 }) =>
      eventLines({ calendar, daysBack: 0, daysAhead, query }),

    async createEvent({ recurrence, ...input }) {
      const rule = recurrence && recurrenceRule(recurrence);
      const id = await run(calendarCreateEventScript({ ...input, recurrenceRule: rule }));
      return { id, recurrenceRule: rule };
    },

    async updateEvent({ calendar, title, id, ...changes }) {
      await run(
        calendarUpdateEventScript(calendar, eventSpecifier({ title, id }), changes),
        { timeoutMs: SLOW_QUERY_TIMEOUT_MS },
      );
    },

    async deleteEvent({ calendar, title, id }) {
      const specifier = eventSpecifier({ title, id });

      await run(`tell application "Calendar" to tell calendar ${quoted(calendar)}
  ${requireEvent(specifier)}
  delete ${specifier}
end tell`);
    },
  };
}
