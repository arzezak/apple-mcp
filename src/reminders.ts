import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAndConfirm,
  runAndReport,
  runNameList,
  quoted,
  appleScriptDateLiteral,
  hasTimeComponent,
  joinLinefeedScript,
  SLOW_QUERY_TIMEOUT_MS,
} from "./osascript.ts";
import { jsonResult } from "./results.ts";

function shouldUseAllDayDueDate(dueDate: string, allDay: boolean): boolean {
  return allDay || !hasTimeComponent(dueDate);
}

const PROPERTY_LIST_VARS = {
  name: "nameList",
  "due date": "dueDateList",
  "allday due date": "allDayDueDateList",
  priority: "priorityList",
  body: "bodyList",
} as const;

type ReminderProperty = keyof typeof PROPERTY_LIST_VARS;

// Loop body shared by the two list scripts below; read maps a reminder
// property to the AppleScript expression that reads it for the current
// iteration, so both fetch shapes render identical lines.
function reminderLineStatements(
  read: (property: ReminderProperty) => string,
): string {
  return `set line_ to "- " & ${read("name")}
    try
      set d to ${read("due date")}
      if d is missing value then set d to ${read("allday due date")}
      if d is not missing value then set line_ to line_ & " | due: " & (d as text)
    end try
    try
      set p to ${read("priority")}
      if p is not 0 then set line_ to line_ & " | priority: " & p
    end try
    try
      set b to ${read("body")}
      if b is not missing value and b is not "" then set line_ to line_ & " | notes: " & b
    end try
    set end of outputLines to line_`;
}

// Fastest measured shape when filtering: "properties of" evaluates the
// completed filter once and the loop reads local records, where separate
// per-property fetches re-evaluate the filter four times.
function incompleteRemindersScript(listName: string): string {
  return `tell application "Reminders"
  tell list ${quoted(listName)}
    set recordList to properties of (every reminder whose completed is false)
  end tell
  set outputLines to {}
  repeat with r in recordList
    ${reminderLineStatements((property) => `${property} of r`)}
  end repeat
  ${joinLinefeedScript("outputLines")}
end tell`;
}

// Fastest measured shape without a filter: per-property bulk fetches.
// "properties of every reminder" is several times slower here because full
// records for every completed reminder come back too.
function allRemindersScript(listName: string): string {
  return `tell application "Reminders"
  tell list ${quoted(listName)}
    set nameList to name of every reminder
    set bodyList to body of every reminder
    set dueDateList to due date of every reminder
    set allDayDueDateList to allday due date of every reminder
    set priorityList to priority of every reminder
  end tell
  set outputLines to {}
  repeat with i from 1 to count of nameList
    ${reminderLineStatements((property) => `item i of ${PROPERTY_LIST_VARS[property]}`)}
  end repeat
  ${joinLinefeedScript("outputLines")}
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
  const props: string[] = [`name:${quoted(name)}`];
  if (notes) props.push(`body:${quoted(notes)}`);
  if (dueDate) {
    const dueDateProperty = shouldUseAllDayDueDate(dueDate, allDay)
      ? "allday due date"
      : "due date";
    props.push(`${dueDateProperty}:${appleScriptDateLiteral(dueDate)}`);
  }
  if (priority !== undefined) props.push(`priority:${priority}`);

  return `tell application "Reminders" to tell list ${quoted(listName)} to make new reminder with properties {${props.join(", ")}}`;
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
      return runAndReport(script, "No reminders found.");
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
    async (input) => {
      return runAndConfirm(
        reminderCreateScript(input),
        `Created reminder "${input.name}" in list "${input.listName}".`,
      );
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
      const script = `tell application "Reminders" to tell list ${quoted(listName)} to set completed of (first reminder whose name is ${quoted(name)}) to true`;
      return runAndConfirm(script, `Completed reminder "${name}".`);
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
      const script = `tell application "Reminders" to delete (first reminder of list ${quoted(listName)} whose name is ${quoted(name)})`;
      return runAndConfirm(script, `Deleted reminder "${name}".`);
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
          `name of (every reminder whose name contains ${quoted(query)}${completedClause})`,
          SLOW_QUERY_TIMEOUT_MS,
        ),
      );
    },
  );
}
