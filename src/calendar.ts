import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAppleScript,
  runNameList,
  matchClause,
  matchLabel,
  deleteFirstMatching,
  parseList,
  quoted,
  appleScriptDateLiteral,
  joinLinefeedScript,
  scopeExpression,
  SLOW_QUERY_TIMEOUT_MS,
  type RunScript,
} from "./osascript.ts";
import { jsonResult, linesResult, textResult } from "./results.ts";
import { recurrenceSchema, recurrenceRule, type Recurrence } from "./recurrence.ts";

function setTimeOfDay(varName: string, hour = 0, minute = 0): string {
  return `set hours of ${varName} to ${hour}
set minutes of ${varName} to ${minute}
set seconds of ${varName} to 0`;
}

// "properties of" evaluates the expensive whose filter once per calendar;
// per-property reads in the loop would pay one round trip per property per event.
function eventQueryScript(
  calendar: string | undefined,
  dateSetup: string,
  eventFilter: string,
): string {
  const includeCalendarName = !calendar;
  const calNameSetup = includeCalendarName ? `set calName to name of cal\n    ` : "";
  const linePrefix = includeCalendarName ? `calName & ": " & ` : "";

  return `
${dateSetup}

tell application "Calendar"
  set outputLines to {}
  repeat with cal in ${scopeExpression("calendar", calendar)}
    ${calNameSetup}set recordList to properties of (every event of cal ${eventFilter})
    repeat with r in recordList
      set eventLine to (${linePrefix}summary of r & " | " & (start date of r as text) & " → " & (end date of r as text))
      set loc to location of r
      if loc is not missing value and loc is not "" then set eventLine to eventLine & " @ " & loc
      set eventLine to eventLine & " | id: " & uid of r
      set end of outputLines to eventLine
    end repeat
  end repeat
  ${joinLinefeedScript("outputLines")}
end tell`;
}

function eventRangeScript(
  calendar: string | undefined,
  daysBack: number,
  daysAhead: number,
  extraFilter?: string,
): string {
  const dateSetup = `set theStart to current date
${setTimeOfDay("theStart")}
set theEnd to theStart + (${daysAhead} * days) - 1
set theStart to theStart - (${daysBack} * days)`;
  const filter =
    "start date is greater than or equal to theStart and start date is less than or equal to theEnd" +
    (extraFilter ? ` and ${extraFilter}` : "");
  return eventQueryScript(calendar, dateSetup, `whose ${filter}`);
}

type CreateEventInput = {
  calendar: string;
  title: string;
  startDate?: string;
  daysFromNow?: number;
  hour: number;
  minute?: number;
  durationMinutes?: number;
  location?: string;
  notes?: string;
  allDay?: boolean;
};

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
}: CreateEventInput & { recurrenceRule?: string }): string {
  const props: string[] = [`summary:${quoted(title)}`];
  if (location) props.push(`location:${quoted(location)}`);
  if (notes) props.push(`description:${quoted(notes)}`);
  if (allDay) props.push("allday event:true");
  if (recurrenceRule) props.push(`recurrence:${quoted(recurrenceRule)}`);

  const dateSetup = allDay
    ? `${setTimeOfDay("theStart")}
set theEnd to theStart + days - 1`
    : `${setTimeOfDay("theStart", hour, minute)}
set theEnd to theStart + (${durationMinutes} * minutes)`;
  const startSetup = startDate
    ? `set theStart to ${appleScriptDateLiteral(startDate)}`
    : `set theStart to current date
set theStart to theStart + (${daysFromNow} * days)`;

  return `
${startSetup}
${dateSetup}
tell application "Calendar"
  tell calendar ${quoted(calendar)}
    set createdEvent to make new event with properties {start date:theStart, end date:theEnd, ${props.join(", ")}}
    return uid of createdEvent
  end tell
end tell`;
}

export type EventMatch = { calendar: string; title?: string; id?: string };

export type EventChanges = {
  newTitle?: string;
  startDate?: string;
  hour?: number;
  minute?: number;
  durationMinutes?: number;
  location?: string;
  notes?: string;
  allDay?: boolean;
};

// `event id` resolves in ~0.3s where `first event whose uid is` scans the
// whole calendar (~29s measured 2026-11-05).
function eventSpecifier({ title, id }: { title?: string; id?: string }): string {
  if ((title === undefined) === (id === undefined)) {
    throw new Error("Provide exactly one of title or id.");
  }
  return id !== undefined
    ? `event id ${quoted(id)}`
    : `first event whose summary is ${quoted(title!)}`;
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
      ? `set theStart to ${appleScriptDateLiteral(startDate)}`
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
  if not (exists ${specifier}) then error "No matching event." number 1
  tell ${specifier}
    ${sets.join("\n    ")}
  end tell
end tell`;
}

export type Calendar = {
  listCalendars(): Promise<string[]>;
  listEvents(input: {
    calendar?: string;
    daysAhead?: number;
    daysBack?: number;
  }): Promise<string[]>;
  searchEvents(input: {
    query: string;
    calendar?: string;
    daysAhead?: number;
  }): Promise<string[]>;
  createEvent(
    input: CreateEventInput & { recurrence?: Recurrence },
  ): Promise<{ id: string; recurrenceRule?: string }>;
  updateEvent(input: EventMatch & EventChanges): Promise<void>;
  deleteEvent(match: EventMatch): Promise<void>;
};

export function createCalendar(run: RunScript = runAppleScript): Calendar {
  return {
    listCalendars: () => runNameList(run, "Calendar", "name of every calendar"),

    async listEvents({ calendar, daysAhead = 1, daysBack = 0 }) {
      return parseList(
        await run(
          eventRangeScript(calendar, daysBack, daysAhead),
          SLOW_QUERY_TIMEOUT_MS,
        ),
      );
    },

    async searchEvents({ query, calendar, daysAhead = 30 }) {
      return parseList(
        await run(
          eventRangeScript(calendar, 0, daysAhead, `summary contains ${quoted(query)}`),
          SLOW_QUERY_TIMEOUT_MS,
        ),
      );
    },

    async createEvent({ recurrence, ...input }) {
      const rule = recurrence && recurrenceRule(recurrence);
      const id = await run(calendarCreateEventScript({ ...input, recurrenceRule: rule }));
      return { id, recurrenceRule: rule };
    },

    async updateEvent({ calendar, title, id, ...changes }) {
      await run(
        calendarUpdateEventScript(calendar, eventSpecifier({ title, id }), changes),
        SLOW_QUERY_TIMEOUT_MS,
      );
    },

    async deleteEvent({ calendar, title, id }) {
      const { clause } = matchClause({
        nameProperty: "summary",
        name: title,
        id,
        idProperty: "uid",
      });
      await run(`tell application "Calendar" to tell calendar ${quoted(calendar)}
  ${deleteFirstMatching("event", clause)}
end tell`);
    },
  };
}

const calendarField = z
  .string()
  .optional()
  .describe("Calendar name. Omit to search all calendars.");

const eventIdField = z
  .string()
  .optional()
  .describe(
    "Event id as returned by calendar_create_event or the listing tools; use instead of title",
  );

export function registerCalendarTools(
  server: McpServer,
  calendar: Calendar = createCalendar(),
) {
  server.registerTool(
    "calendar_list_calendars",
    {
      title: "List Calendars",
      description: "Get all calendar names from Apple Calendar",
    },
    async () => jsonResult(await calendar.listCalendars()),
  );

  server.registerTool(
    "calendar_list_events",
    {
      title: "List Calendar Events",
      description:
        "List events for a date range. Defaults to today. Can scope to a specific calendar or search all. Each line ends with the event id.",
      inputSchema: {
        calendar: calendarField,
        daysAhead: z
          .number()
          .default(1)
          .describe(
            "Number of days to look ahead from today (default: 1 = today only)",
          ),
        daysBack: z
          .number()
          .default(0)
          .describe("Number of days to look back from today (default: 0)"),
      },
    },
    async (input) => linesResult(await calendar.listEvents(input), "No events found."),
  );

  server.registerTool(
    "calendar_create_event",
    {
      title: "Create Calendar Event",
      description: "Create a new event in Apple Calendar",
      inputSchema: {
        calendar: z.string().describe("Calendar name to create the event in"),
        title: z.string().describe("Event title"),
        startDate: z
          .string()
          .optional()
          .describe(
            "Optional ISO start date. When omitted, daysFromNow is used. Timed events still use hour/minute for the time of day.",
          ),
        daysFromNow: z
          .number()
          .default(0)
          .describe("Days from today (0 = today, 1 = tomorrow, etc.)"),
        hour: z.number().min(0).max(23).describe("Start hour (24h format)"),
        minute: z.number().min(0).max(59).default(0).describe("Start minute"),
        durationMinutes: z
          .number()
          .default(60)
          .describe("Duration in minutes (default: 60)"),
        location: z.string().optional().describe("Event location"),
        notes: z.string().optional().describe("Event notes/description"),
        allDay: z
          .boolean()
          .default(false)
          .describe("Create as an all-day event"),
        recurrence: recurrenceSchema
          .optional()
          .describe(
            'Optional recurrence rule. Example: {"frequency":"monthly","interval":4} repeats every 4 months indefinitely.',
          ),
      },
    },
    async (input) => {
      const { id, recurrenceRule } = await calendar.createEvent(input);
      const suffix = recurrenceRule ? ` with recurrence ${recurrenceRule}` : "";
      return textResult(
        `Created event "${input.title}" on calendar "${input.calendar}"${suffix} (id: ${id}).`,
      );
    },
  );

  server.registerTool(
    "calendar_search_events",
    {
      title: "Search Calendar Events",
      description:
        "Search for events by name. Scopes to a specific calendar and upcoming 30 days by default.",
      inputSchema: {
        query: z.string().describe("Search term to match in event titles"),
        calendar: calendarField,
        daysAhead: z
          .number()
          .default(30)
          .describe("How many days ahead to search (default: 30)"),
      },
    },
    async (input) => linesResult(await calendar.searchEvents(input), "No events found."),
  );

  server.registerTool(
    "calendar_update_event",
    {
      title: "Update Calendar Event",
      description:
        "Change an event in place: title, location, notes, date, time, duration or all-day. Finds it by exact title or by id. startDate alone moves the day and keeps the time and duration.",
      inputSchema: {
        calendar: z.string().describe("Calendar name"),
        title: z.string().optional().describe("Exact current title of the event"),
        id: eventIdField,
        newTitle: z.string().optional().describe("New title"),
        startDate: z.string().optional().describe("New ISO date, e.g. 2026-12-03"),
        hour: z.number().min(0).max(23).optional().describe("New start hour (24h)"),
        minute: z.number().min(0).max(59).optional().describe("New start minute"),
        durationMinutes: z.number().optional().describe("New duration in minutes"),
        location: z.string().optional().describe("New location"),
        notes: z.string().optional().describe("New notes/description"),
        allDay: z.boolean().optional().describe("Make the event all-day (true) or timed (false)"),
      },
    },
    async (input) => {
      await calendar.updateEvent(input);
      return textResult(
        `Updated event ${matchLabel({ name: input.title, id: input.id })}.`,
      );
    },
  );

  server.registerTool(
    "calendar_delete_event",
    {
      title: "Delete Calendar Event",
      description:
        "Delete an event by its exact title or by id. Deletes the first match on the specified calendar.",
      inputSchema: {
        calendar: z.string().describe("Calendar name"),
        title: z.string().optional().describe("Exact title of the event to delete"),
        id: eventIdField,
      },
    },
    async (input) => {
      await calendar.deleteEvent(input);
      return textResult(
        `Deleted event ${matchLabel({ name: input.title, id: input.id })}.`,
      );
    },
  );
}
