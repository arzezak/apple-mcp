import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, runNameList, esc } from "./osascript.ts";
import { textResult, jsonResult } from "./results.ts";

// Event queries pay a few seconds per calendar for the whose filter, so
// all-calendars queries on accounts with many calendars exceed the default
// 30s osascript timeout.
const EVENT_QUERY_TIMEOUT_MS = 120_000;

function calendarsExpression(calendar?: string): string {
  return calendar ? `{calendar "${esc(calendar)}"}` : "every calendar";
}

function setTimeOfDay(varName: string, hour = 0, minute = 0): string {
  return `set hours of ${varName} to ${hour}
set minutes of ${varName} to ${minute}
set seconds of ${varName} to 0`;
}

// Fetches event records with one "properties of" Apple Event per calendar:
// the (expensive) whose filter is evaluated once and the loop reads local
// records, instead of paying one round trip per property per event.
function eventQueryScript(
  calendars: string,
  includeCalendarName: boolean,
  dateSetup: string,
  eventFilter: string,
): string {
  const linePrefix = includeCalendarName ? `calName & ": " & ` : "";

  return `
${dateSetup}

tell application "Calendar"
  set outputLines to {}
  repeat with cal in ${calendars}
    set calName to name of cal
    set recordList to properties of (every event of cal ${eventFilter})
    repeat with r in recordList
      set end of outputLines to (${linePrefix}summary of r & " | " & (start date of r as text) & " → " & (end date of r as text))
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  outputLines as text
end tell`;
}

export function calendarCreateEventScript({
  calendar,
  title,
  daysFromNow,
  hour,
  minute,
  durationMinutes,
  location,
  notes,
  allDay,
}: {
  calendar: string;
  title: string;
  daysFromNow: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  location?: string;
  notes?: string;
  allDay: boolean;
}): string {
  const props: string[] = [`summary:"${esc(title)}"`];
  if (location) props.push(`location:"${esc(location)}"`);
  if (notes) props.push(`description:"${esc(notes)}"`);
  if (allDay) props.push("allday event:true");

  const dateSetup = allDay
    ? `${setTimeOfDay("theStart")}
set theEnd to theStart + days - 1`
    : `${setTimeOfDay("theStart", hour, minute)}
set theEnd to theStart + (${durationMinutes} * minutes)`;

  return `
set theStart to current date
set theStart to theStart + (${daysFromNow} * days)
${dateSetup}
tell application "Calendar"
  tell calendar "${esc(calendar)}"
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
      const eventFilter = `whose start date is greater than or equal to theStart and start date is less than or equal to theEnd`;
      const raw = await runAppleScript(
        eventQueryScript(
          calendarsExpression(calendar),
          !calendar,
          dateSetup,
          eventFilter,
        ),
        EVENT_QUERY_TIMEOUT_MS,
      );
      return textResult(raw || "No events found.");
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
      },
    },
    async ({
      calendar,
      title,
      daysFromNow,
      hour,
      minute,
      durationMinutes,
      location,
      notes,
      allDay,
    }) => {
      const script = calendarCreateEventScript({
        calendar,
        title,
        daysFromNow,
        hour,
        minute,
        durationMinutes,
        location,
        notes,
        allDay,
      });

      await runAppleScript(script);
      return textResult(`Created event "${title}" on calendar "${calendar}".`);
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
      const eventFilter = `whose summary contains "${esc(query)}" and start date is greater than or equal to theStart and start date is less than or equal to theEnd`;
      const raw = await runAppleScript(
        eventQueryScript(
          calendarsExpression(calendar),
          !calendar,
          dateSetup,
          eventFilter,
        ),
        EVENT_QUERY_TIMEOUT_MS,
      );
      return textResult(raw || "No events found.");
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
      const script = `tell application "Calendar" to tell calendar "${esc(calendar)}" to delete (first event whose summary is "${esc(title)}")`;
      await runAppleScript(script);
      return textResult(`Deleted event "${title}".`);
    },
  );
}
