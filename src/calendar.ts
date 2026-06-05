import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, parseList, esc, textResult } from "./osascript.ts";

function eventQueryScript(
  calScope: string | null,
  dateSetup: string,
  eventFilter: string,
): string {
  const outputLine = calScope
    ? `summary of e & " | " & (start date of e as text) & " → " & (end date of e as text)`
    : `name of cal & ": " & summary of e & " | " & (start date of e as text) & " → " & (end date of e as text)`;

  const body = calScope
    ? `tell ${calScope}
    set evts to (every event ${eventFilter})
    repeat with e in evts
      set output to output & ${outputLine} & linefeed
    end repeat
  end tell`
    : `repeat with cal in every calendar
    set evts to (every event of cal ${eventFilter})
    repeat with e in evts
      set output to output & ${outputLine} & linefeed
    end repeat
  end repeat`;

  return `
${dateSetup}

tell application "Calendar"
  set output to ""
  ${body}
  output
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
      const raw = await runAppleScript(
        'tell application "Calendar" to name of every calendar',
      );
      return textResult(JSON.stringify(parseList(raw), null, 2));
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
      const calScope = calendar ? `calendar "${esc(calendar)}"` : null;
      const dateSetup = `set midnight to current date
set hours of midnight to 0
set minutes of midnight to 0
set seconds of midnight to 0
set theStart to midnight - (${daysBack} * days)
set theEnd to midnight + (${daysAhead} * days) - 1`;
      const eventFilter = `whose start date is greater than or equal to theStart and start date is less than or equal to theEnd`;
      const raw = await runAppleScript(
        eventQueryScript(calScope, dateSetup, eventFilter),
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
      const props: string[] = [`summary:"${esc(title)}"`];
      if (location) props.push(`location:"${esc(location)}"`);
      if (notes) props.push(`description:"${esc(notes)}"`);

      let script: string;
      if (allDay) {
        props.push("allday event:true");
        script = `
set theDate to current date
set theDate to theDate + (${daysFromNow} * days)
set hours of theDate to 0
set minutes of theDate to 0
set seconds of theDate to 0
tell application "Calendar"
  tell calendar "${esc(calendar)}"
    make new event with properties {start date:theDate, ${props.join(", ")}}
  end tell
end tell`;
      } else {
        script = `
set theStart to current date
set theStart to theStart + (${daysFromNow} * days)
set hours of theStart to ${hour}
set minutes of theStart to ${minute}
set seconds of theStart to 0
set theEnd to theStart + (${durationMinutes} * minutes)
tell application "Calendar"
  tell calendar "${esc(calendar)}"
    make new event with properties {start date:theStart, end date:theEnd, ${props.join(", ")}}
  end tell
end tell`;
      }

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
      const calScope = calendar ? `calendar "${esc(calendar)}"` : null;
      const dateSetup = `set theStart to current date
set hours of theStart to 0
set minutes of theStart to 0
set seconds of theStart to 0
set theEnd to theStart + (${daysAhead} * days)`;
      const eventFilter = `whose summary contains "${esc(query)}" and start date is greater than or equal to theStart and start date is less than or equal to theEnd`;
      const raw = await runAppleScript(
        eventQueryScript(calScope, dateSetup, eventFilter),
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
