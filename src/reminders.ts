import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAppleScript,
  runNameList,
  esc,
  appleScriptDateLiteral,
} from "./osascript.ts";
import { textResult, jsonResult } from "./results.ts";

const TIME_COMPONENT_RE =
  /(?:[ T]\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b)/i;

function shouldUseAllDayDueDate(dueDate: string, allDay: boolean): boolean {
  return allDay || !TIME_COMPONENT_RE.test(dueDate);
}

// Fastest measured shape when filtering: "properties of" evaluates the
// completed filter once and the loop reads local records, where separate
// per-property fetches re-evaluate the filter four times.
function incompleteRemindersScript(listName: string): string {
  return `tell application "Reminders"
  tell list "${esc(listName)}"
    set recordList to properties of (every reminder whose completed is false)
  end tell
  set outputLines to {}
  repeat with r in recordList
    set line_ to "- " & name of r
    try
      set d to due date of r
      if d is missing value then set d to allday due date of r
      if d is not missing value then set line_ to line_ & " | due: " & (d as text)
    end try
    try
      set p to priority of r
      if p is not 0 then set line_ to line_ & " | priority: " & p
    end try
    try
      set b to body of r
      if b is not missing value and b is not "" then set line_ to line_ & " | notes: " & b
    end try
    set end of outputLines to line_
  end repeat
  set AppleScript's text item delimiters to linefeed
  outputLines as text
end tell`;
}

// Fastest measured shape without a filter: per-property bulk fetches.
// "properties of every reminder" is several times slower here because full
// records for every completed reminder come back too.
function allRemindersScript(listName: string): string {
  return `tell application "Reminders"
  tell list "${esc(listName)}"
    set nameList to name of every reminder
    set bodyList to body of every reminder
    set dueDateList to due date of every reminder
    set allDayDueDateList to allday due date of every reminder
    set priorityList to priority of every reminder
  end tell
  set outputLines to {}
  repeat with i from 1 to count of nameList
    set line_ to "- " & item i of nameList
    try
      set d to item i of dueDateList
      if d is missing value then set d to item i of allDayDueDateList
      if d is not missing value then set line_ to line_ & " | due: " & (d as text)
    end try
    try
      set p to item i of priorityList
      if p is not 0 then set line_ to line_ & " | priority: " & p
    end try
    try
      set b to item i of bodyList
      if b is not missing value and b is not "" then set line_ to line_ & " | notes: " & b
    end try
    set end of outputLines to line_
  end repeat
  set AppleScript's text item delimiters to linefeed
  outputLines as text
end tell`;
}

export function reminderCreateScript({
  listName,
  name,
  notes,
  dueDate,
  allDay,
  priority,
}: {
  listName: string;
  name: string;
  notes?: string;
  dueDate?: string;
  allDay: boolean;
  priority?: number;
}): string {
  const props: string[] = [`name:"${esc(name)}"`];
  if (notes) props.push(`body:"${esc(notes)}"`);
  if (dueDate) {
    const dueDateProperty = shouldUseAllDayDueDate(dueDate, allDay)
      ? "allday due date"
      : "due date";
    props.push(`${dueDateProperty}:${appleScriptDateLiteral(dueDate)}`);
  }
  if (priority !== undefined) props.push(`priority:${priority}`);

  return `tell application "Reminders" to tell list "${esc(listName)}" to make new reminder with properties {${props.join(", ")}}`;
}

export function registerRemindersTools(server: McpServer) {
  server.registerTool(
    "reminders_list_lists",
    {
      title: "List Reminder Lists",
      description: "Get all reminder list names from Apple Reminders",
    },
    async () => {
      return jsonResult(await runNameList("Reminders", "name of every list"));
    },
  );

  server.registerTool(
    "reminders_list",
    {
      title: "List Reminders",
      description:
        "List reminders in a specific list. Returns name, due date, priority, and notes for each.",
      inputSchema: {
        listName: z.string().describe("Name of the reminder list"),
        includeCompleted: z
          .boolean()
          .default(false)
          .describe("Include completed reminders"),
      },
    },
    async ({ listName, includeCompleted }) => {
      const script = includeCompleted
        ? allRemindersScript(listName)
        : incompleteRemindersScript(listName);
      const raw = await runAppleScript(script);
      return textResult(raw || "No reminders found.");
    },
  );

  server.registerTool(
    "reminders_create",
    {
      title: "Create Reminder",
      description: "Create a new reminder in Apple Reminders",
      inputSchema: {
        listName: z.string().describe("Name of the reminder list"),
        name: z.string().describe("Reminder title"),
        notes: z.string().optional().describe("Notes/body for the reminder"),
        dueDate: z
          .string()
          .optional()
          .describe(
            'Due date string in locale format, e.g. "2026-06-10 09:00:00" or "June 10, 2026 9:00 AM"',
          ),
        allDay: z
          .boolean()
          .default(false)
          .describe(
            "Create with an all-day due date. Date-only dueDate values are treated as all-day even when this is false.",
          ),
        priority: z
          .number()
          .min(0)
          .max(9)
          .optional()
          .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
      },
    },
    async ({ listName, name, notes, dueDate, allDay, priority }) => {
      const script = reminderCreateScript({
        listName,
        name,
        notes,
        dueDate,
        allDay,
        priority,
      });
      await runAppleScript(script);
      return textResult(`Created reminder "${name}" in list "${listName}".`);
    },
  );

  server.registerTool(
    "reminders_complete",
    {
      title: "Complete Reminder",
      description: "Mark a reminder as completed",
      inputSchema: {
        listName: z.string().describe("Name of the reminder list"),
        name: z.string().describe("Exact name of the reminder to complete"),
      },
    },
    async ({ listName, name }) => {
      const script = `tell application "Reminders" to tell list "${esc(listName)}" to set completed of (first reminder whose name is "${esc(name)}") to true`;
      await runAppleScript(script);
      return textResult(`Completed reminder "${name}".`);
    },
  );

  server.registerTool(
    "reminders_delete",
    {
      title: "Delete Reminder",
      description: "Delete a reminder from a list",
      inputSchema: {
        listName: z.string().describe("Name of the reminder list"),
        name: z.string().describe("Exact name of the reminder to delete"),
      },
    },
    async ({ listName, name }) => {
      const script = `tell application "Reminders" to delete (first reminder of list "${esc(listName)}" whose name is "${esc(name)}")`;
      await runAppleScript(script);
      return textResult(`Deleted reminder "${name}".`);
    },
  );

  server.registerTool(
    "reminders_search",
    {
      title: "Search Reminders",
      description:
        "Search for reminders by name across all lists. Returns only incomplete reminders by default.",
      inputSchema: {
        query: z.string().describe("Search term to match in reminder names"),
        includeCompleted: z
          .boolean()
          .default(false)
          .describe("Include completed reminders in search"),
      },
    },
    async ({ query, includeCompleted }) => {
      const completedClause = includeCompleted ? "" : " and completed is false";
      // Scans every reminder across all lists; measured near the default 30s
      // timeout on large databases.
      return jsonResult(
        await runNameList(
          "Reminders",
          `name of (every reminder whose name contains "${esc(query)}"${completedClause})`,
          120_000,
        ),
      );
    },
  );
}
