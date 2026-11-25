import { z } from "zod";
import { recurrenceSchema } from "./recurrence.ts";

const listNameField = z.string().describe("Name of the reminder list");

const reminderIdField = z
  .string()
  .optional()
  .describe("Reminder id as returned by reminders_create, reminders_list or reminders_search; use instead of name");

const dueDateField = z
  .string()
  .optional()
  .describe(
    'Due date as YYYY-MM-DD (all-day) or YYYY-MM-DD HH:MM[:SS], e.g. "2026-06-10 09:00:00"',
  );

const priorityField = z
  .number()
  .min(0)
  .max(9)
  .optional()
  .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low");

export const listRemindersInput = z.object({
  listName: listNameField,
  includeCompleted: z
    .boolean()
    .default(false)
    .describe("Include completed reminders"),
});

export const createReminderInput = z.object({
  listName: listNameField,
  name: z.string().describe("Reminder title"),
  notes: z.string().optional().describe("Notes/body for the reminder"),
  dueDate: dueDateField,
  allDay: z
    .boolean()
    .default(false)
    .describe(
      "Create with an all-day due date. Date-only dueDate values are treated as all-day even when this is false.",
    ),
  priority: priorityField,
  recurrence: recurrenceSchema
    .optional()
    .describe(
      'Optional recurrence rule, same shape as calendar_create_event. Example: {"frequency":"monthly","interval":1} repeats every month.',
    ),
});

export const updateReminderInput = z.object({
  listName: listNameField,
  name: z.string().optional().describe("Exact current name of the reminder"),
  id: reminderIdField,
  title: z.string().optional().describe("New title"),
  notes: z.string().optional().describe("New notes/body"),
  dueDate: dueDateField,
  allDay: z
    .boolean()
    .optional()
    .describe("With dueDate: make it an all-day due date"),
  priority: priorityField,
});

export const completeReminderInput = z.object({
  listName: listNameField,
  name: z.string().optional().describe("Exact name of the reminder to complete"),
  id: reminderIdField,
});

export const deleteReminderInput = z.object({
  listName: listNameField,
  name: z.string().optional().describe("Exact name of the reminder to delete"),
  id: reminderIdField,
});

export const searchRemindersInput = z.object({
  query: z.string().describe("Search term to match in reminder names"),
  includeCompleted: z
    .boolean()
    .default(false)
    .describe("Include completed reminders in search"),
});

export type ListRemindersInput = z.input<typeof listRemindersInput>;
export type CreateReminderInput = z.input<typeof createReminderInput>;
export type UpdateReminderInput = z.input<typeof updateReminderInput>;
export type CompleteReminderInput = z.input<typeof completeReminderInput>;
export type DeleteReminderInput = z.input<typeof deleteReminderInput>;
export type SearchRemindersInput = z.input<typeof searchRemindersInput>;
export type ReminderMatch = Pick<UpdateReminderInput, "listName" | "name" | "id">;
export type ReminderChanges = Omit<UpdateReminderInput, keyof ReminderMatch>;
