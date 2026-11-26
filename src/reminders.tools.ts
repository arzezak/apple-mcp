import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { matchLabel } from "./matching.ts";
import { jsonResult, linesResult, textResult } from "./results.ts";
import { createReminders, type Reminders } from "./reminders.ts";
import {
  listRemindersInput,
  createReminderInput,
  updateReminderInput,
  completeReminderInput,
  deleteReminderInput,
  searchRemindersInput,
} from "./reminders.inputs.ts";

export function registerRemindersTools(
  server: McpServer,
  reminders: Reminders = createReminders(),
) {
  server.registerTool(
    "reminders_list_lists",
    {
      title: "List Reminder Lists",
      description: "Get all reminder list names from Apple Reminders",
    },
    async () => jsonResult(await reminders.listLists()),
  );

  server.registerTool(
    "reminders_list",
    {
      title: "List Reminders",
      description:
        "List reminders in a specific list. Returns name, due date, priority, notes, and id for each.",
      inputSchema: listRemindersInput.shape,
    },
    async (input) => linesResult(await reminders.list(input), "No reminders found."),
  );

  server.registerTool(
    "reminders_create",
    {
      title: "Create Reminder",
      description: "Create a new reminder in Apple Reminders",
      inputSchema: createReminderInput.shape,
    },
    async (input) => {
      const { id, recurrenceRule } = await reminders.create(input);
      const suffix = recurrenceRule ? ` with recurrence ${recurrenceRule}` : "";

      return textResult(
        `Created reminder "${input.name}" in list "${input.listName}"${suffix} (id: ${id}).`,
      );
    },
  );

  server.registerTool(
    "reminders_update",
    {
      title: "Update Reminder",
      description:
        "Change a reminder's title, notes, due date or priority in place. Finds it by exact name or by id.",
      inputSchema: updateReminderInput.shape,
    },
    async (input) => {
      await reminders.update(input);
      return textResult(`Updated reminder ${matchLabel(input)}.`);
    },
  );

  server.registerTool(
    "reminders_complete",
    {
      title: "Complete Reminder",
      description: "Mark a reminder as completed",
      inputSchema: completeReminderInput.shape,
    },
    async (input) => {
      await reminders.complete(input);
      return textResult(`Completed reminder ${matchLabel(input)}.`);
    },
  );

  server.registerTool(
    "reminders_delete",
    {
      title: "Delete Reminder",
      description: "Delete a reminder from a list",
      inputSchema: deleteReminderInput.shape,
    },
    async (input) => {
      await reminders.delete(input);
      return textResult(`Deleted reminder ${matchLabel(input)}.`);
    },
  );

  server.registerTool(
    "reminders_search",
    {
      title: "Search Reminders",
      description:
        "Search for reminders by name across all lists. Returns only incomplete reminders by default, one line each with list name, due date, priority, notes, and id. With includeCompleted, returns names only.",
      inputSchema: searchRemindersInput.shape,
    },
    async (input) => linesResult(await reminders.search(input), "No reminders found."),
  );
}
