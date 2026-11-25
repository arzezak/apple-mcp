import { z } from "zod";
import { recurrenceSchema } from "./recurrence.ts";

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

export const listEventsInput = z.object({
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
});

export const createEventInput = z.object({
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
});

export const searchEventsInput = z.object({
  query: z.string().describe("Search term to match in event titles"),
  calendar: calendarField,
  daysAhead: z
    .number()
    .default(30)
    .describe("How many days ahead to search (default: 30)"),
});

export const updateEventInput = z.object({
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
});

export const deleteEventInput = z.object({
  calendar: z.string().describe("Calendar name"),
  title: z.string().optional().describe("Exact title of the event to delete"),
  id: eventIdField,
});

export type ListEventsInput = z.input<typeof listEventsInput>;
export type CreateEventInput = z.input<typeof createEventInput>;
export type SearchEventsInput = z.input<typeof searchEventsInput>;
export type UpdateEventInput = z.input<typeof updateEventInput>;
export type EventMatch = Pick<UpdateEventInput, "calendar" | "title" | "id">;
export type EventChanges = Omit<UpdateEventInput, keyof EventMatch>;
