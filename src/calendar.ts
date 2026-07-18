import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAndConfirm,
  runAndReport,
  runNameList,
  quoted,
  appleScriptDateLiteral,
  joinLinefeedScript,
  scopeExpression,
  SLOW_QUERY_TIMEOUT_MS,
} from "./osascript.ts";
import { jsonResult } from "./results.ts";

const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;

type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

type Recurrence = {
  frequency: RecurrenceFrequency;
  interval: number;
  count?: number;
  until?: string;
};

function setTimeOfDay(varName: string, hour = 0, minute = 0): string {
  return `set hours of ${varName} to ${hour}
set minutes of ${varName} to ${minute}
set seconds of ${varName} to 0`;
}

function rruleDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid recurrence until date: ${input}`);
  }

  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

export function calendarRecurrenceRule(recurrence: Recurrence): string {
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    throw new Error("Recurrence interval must be a positive integer.");
  }
  if (
    recurrence.count !== undefined &&
    (!Number.isInteger(recurrence.count) || recurrence.count < 1)
  ) {
    throw new Error("Recurrence count must be a positive integer.");
  }
  if (recurrence.count !== undefined && recurrence.until !== undefined) {
    throw new Error("Recurrence can end with count or until, not both.");
  }

  const parts = [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`,
  ];
  if (recurrence.count !== undefined) {
    parts.push(`COUNT=${recurrence.count}`);
  }
  if (recurrence.until !== undefined) {
    parts.push(`UNTIL=${rruleDate(recurrence.until)}`);
  }
  return parts.join(";");
}

// Fetches event records with one "properties of" Apple Event per calendar:
// the (expensive) whose filter is evaluated once and the loop reads local
// records, instead of paying one round trip per property per event.
// Prefixes each line with the calendar name when searching all calendars.
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
      set end of outputLines to (${linePrefix}summary of r & " | " & (start date of r as text) & " → " & (end date of r as text))
    end repeat
  end repeat
  ${joinLinefeedScript("outputLines")}
end tell`;
}

const DATE_RANGE_FILTER =
  "start date is greater than or equal to theStart and start date is less than or equal to theEnd";

// Shared run shape for the two event query tools: scopes to one calendar or
// all, restricts to the theStart..theEnd range set up by dateSetup, and needs
// the longer timeout because all-calendars queries pay a few seconds per
// calendar for the whose filter.
function runEventQuery(
  calendar: string | undefined,
  dateSetup: string,
  extraFilter?: string,
) {
  const filterClauses = extraFilter
    ? `${extraFilter} and ${DATE_RANGE_FILTER}`
    : DATE_RANGE_FILTER;
  return runAndReport(
    eventQueryScript(calendar, dateSetup, `whose ${filterClauses}`),
    "No events found.",
    SLOW_QUERY_TIMEOUT_MS,
  );
}

export function calendarCreateEventScript({
  calendar,
  title,
  startDate,
  daysFromNow,
  hour,
  minute,
  durationMinutes,
  location,
  notes,
  allDay,
  recurrence,
}: {
  calendar: string;
  title: string;
  startDate?: string;
  daysFromNow: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  location?: string;
  notes?: string;
  allDay: boolean;
  recurrence?: Recurrence;
}): string {
  const props: string[] = [`summary:${quoted(title)}`];
  if (location) props.push(`location:${quoted(location)}`);
  if (notes) props.push(`description:${quoted(notes)}`);
  if (allDay) props.push("allday event:true");
  if (recurrence) {
    props.push(`recurrence:${quoted(calendarRecurrenceRule(recurrence))}`);
  }

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
    make new event with properties {start date:theStart, end date:theEnd, ${props.join(", ")}}
  end tell
end tell`;
}

export function registerCalendarTools(server: McpServer) {
  server.registerTool(
    "calendar_list_calendars",
    {
      title: "List Calendars",
      description: "Get all calendar names from Apple Calendar",
    },
    async () => {
      return jsonResult(await runNameList("Calendar", "name of every calendar"));
    },
  );

  server.registerTool(
    "calendar_list_events",
    {
      title: "List Calendar Events",
      description:
        "List events for a date range. Defaults to today. Can scope to a specific calendar or search all.",
      inputSchema: {
        calendar: z
          .string()
          .optional()
          .describe("Calendar name. Omit to search all calendars."),
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
    async ({ calendar, daysAhead, daysBack }) => {
      const dateSetup = `set midnight to current date
${setTimeOfDay("midnight")}
set theStart to midnight - (${daysBack} * days)
set theEnd to midnight + (${daysAhead} * days) - 1`;
      return runEventQuery(calendar, dateSetup);
    },
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
        recurrence: z
          .object({
            frequency: z
              .enum(RECURRENCE_FREQUENCIES)
              .describe("Repeat frequency: daily, weekly, monthly, or yearly"),
            interval: z
              .number()
              .int()
              .positive()
              .describe(
                "Repeat every N frequency units, e.g. 4 with monthly means every 4 months",
              ),
            count: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Optional end after this many occurrences"),
            until: z
              .string()
              .optional()
              .describe(
                "Optional ISO end date/time. Omit both count and until to repeat indefinitely.",
              ),
          })
          .optional()
          .describe(
            'Optional recurrence rule. Example: {"frequency":"monthly","interval":4} repeats every 4 months indefinitely.',
          ),
      },
    },
    async (input) => {
      const script = calendarCreateEventScript(input);
      const recurrenceSuffix = input.recurrence
        ? ` with recurrence ${calendarRecurrenceRule(input.recurrence)}`
        : "";
      return runAndConfirm(
        script,
        `Created event "${input.title}" on calendar "${input.calendar}"${recurrenceSuffix}.`,
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
        calendar: z
          .string()
          .optional()
          .describe("Calendar name. Omit to search all calendars."),
        daysAhead: z
          .number()
          .default(30)
          .describe("How many days ahead to search (default: 30)"),
      },
    },
    async ({ query, calendar, daysAhead }) => {
      const dateSetup = `set theStart to current date
${setTimeOfDay("theStart")}
set theEnd to theStart + (${daysAhead} * days)`;
      return runEventQuery(calendar, dateSetup, `summary contains ${quoted(query)}`);
    },
  );

  server.registerTool(
    "calendar_delete_event",
    {
      title: "Delete Calendar Event",
      description:
        "Delete an event by its exact title. Deletes the first match on the specified calendar.",
      inputSchema: {
        calendar: z.string().describe("Calendar name"),
        title: z.string().describe("Exact title of the event to delete"),
      },
    },
    async ({ calendar, title }) => {
      const script = `tell application "Calendar" to tell calendar ${quoted(calendar)} to delete (first event whose summary is ${quoted(title)})`;
      return runAndConfirm(script, `Deleted event "${title}".`);
    },
  );
}
