import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { matchLabel } from "./osascript.ts";
import { jsonResult, linesResult, textResult } from "./results.ts";
import { createCalendar, type Calendar } from "./calendar.ts";
import {
  listEventsInput,
  createEventInput,
  searchEventsInput,
  updateEventInput,
  deleteEventInput,
} from "./calendar.inputs.ts";

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
      inputSchema: listEventsInput.shape,
    },
    async (input) => linesResult(await calendar.listEvents(input), "No events found."),
  );

  server.registerTool(
    "calendar_create_event",
    {
      title: "Create Calendar Event",
      description: "Create a new event in Apple Calendar",
      inputSchema: createEventInput.shape,
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
      inputSchema: searchEventsInput.shape,
    },
    async (input) => linesResult(await calendar.searchEvents(input), "No events found."),
  );

  server.registerTool(
    "calendar_update_event",
    {
      title: "Update Calendar Event",
      description:
        "Change an event in place: title, location, notes, date, time, duration or all-day. Finds it by exact title or by id. startDate alone moves the day and keeps the time and duration.",
      inputSchema: updateEventInput.shape,
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
      inputSchema: deleteEventInput.shape,
    },
    async (input) => {
      await calendar.deleteEvent(input);

      return textResult(
        `Deleted event ${matchLabel({ name: input.title, id: input.id })}.`,
      );
    },
  );
}
