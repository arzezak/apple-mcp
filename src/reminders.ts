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
  hasTimeComponent,
  joinLinefeedScript,
  SLOW_QUERY_TIMEOUT_MS,
  type RunScript,
} from "./osascript.ts";
import { jsonResult, linesResult, textResult } from "./results.ts";

const PROPERTY_LIST_VARS = {
  name: "nameList",
  "due date": "dueDateList",
  "allday due date": "allDayDueDateList",
  priority: "priorityList",
  body: "bodyList",
} as const;

type ReminderProperty = keyof typeof PROPERTY_LIST_VARS;

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

// Fastest measured shape when filtering: per-property fetches would
// re-evaluate the completed filter four times.
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

// Fastest measured shape without a filter: "properties of every reminder"
// is several times slower because it returns full records for completed ones too.
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

function reminderCreateScript({
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
  allDay?: boolean;
  priority?: number;
}): string {
  const props: string[] = [`name:${quoted(name)}`];
  if (notes) props.push(`body:${quoted(notes)}`);
  if (dueDate) {
    const dueDateProperty =
      allDay || !hasTimeComponent(dueDate) ? "allday due date" : "due date";
    props.push(`${dueDateProperty}:${appleScriptDateLiteral(dueDate)}`);
  }
  if (priority !== undefined) props.push(`priority:${priority}`);

  return `tell application "Reminders" to tell list ${quoted(listName)} to make new reminder with properties {${props.join(", ")}}`;
}

// Parsed from the make result because reading any property of a just-made
// reminder in-script blocks ~13s (measured 2026-11-04).
function parseReminderId(raw: string): string {
  const id = /x-apple-reminder:\/\/[^\s"]+/.exec(raw)?.[0];
  if (!id) throw new Error(`No reminder id in AppleScript result: ${raw}`);
  return id;
}

export type ReminderMatch = { listName: string; name?: string; id?: string };

export type Reminders = {
  listLists(): Promise<string[]>;
  list(input: { listName: string; includeCompleted?: boolean }): Promise<string[]>;
  create(input: {
    listName: string;
    name: string;
    notes?: string;
    dueDate?: string;
    allDay?: boolean;
    priority?: number;
  }): Promise<{ id: string }>;
  complete(match: ReminderMatch): Promise<void>;
  delete(match: ReminderMatch): Promise<void>;
  search(input: { query: string; includeCompleted?: boolean }): Promise<string[]>;
};

export function createReminders(run: RunScript = runAppleScript): Reminders {
  return {
    listLists: () => runNameList(run, "Reminders", "name of every list"),

    async list({ listName, includeCompleted = false }) {
      const script = includeCompleted
        ? allRemindersScript(listName)
        : incompleteRemindersScript(listName);
      return parseList(await run(script));
    },

    async create(input) {
      return { id: parseReminderId(await run(reminderCreateScript(input))) };
    },

    async complete({ listName, name, id }) {
      const { clause } = matchClause({ nameProperty: "name", name, id });
      await run(
        `tell application "Reminders" to tell list ${quoted(listName)} to set completed of (first reminder whose ${clause}) to true`,
      );
    },

    async delete({ listName, name, id }) {
      const { clause } = matchClause({ nameProperty: "name", name, id });
      await run(`tell application "Reminders" to tell list ${quoted(listName)}
  ${deleteFirstMatching("reminder", clause)}
end tell`);
    },

    search({ query, includeCompleted = false }) {
      const completedClause = includeCompleted ? "" : " and completed is false";
      return runNameList(
        run,
        "Reminders",
        `name of (every reminder whose name contains ${quoted(query)}${completedClause})`,
        SLOW_QUERY_TIMEOUT_MS,
      );
    },
  };
}

const listNameField = z.string().describe("Name of the reminder list");
const reminderIdField = z
  .string()
  .optional()
  .describe("Reminder id as returned by reminders_create; use instead of name");

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
        "List reminders in a specific list. Returns name, due date, priority, and notes for each.",
      inputSchema: {
        listName: listNameField,
        includeCompleted: z
          .boolean()
          .default(false)
          .describe("Include completed reminders"),
      },
    },
    async (input) => linesResult(await reminders.list(input), "No reminders found."),
  );

  server.registerTool(
    "reminders_create",
    {
      title: "Create Reminder",
      description: "Create a new reminder in Apple Reminders",
      inputSchema: {
        listName: listNameField,
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
      const { id } = await reminders.create(input);
      return textResult(
        `Created reminder "${input.name}" in list "${input.listName}" (id: ${id}).`,
      );
    },
  );

  server.registerTool(
    "reminders_complete",
    {
      title: "Complete Reminder",
      description: "Mark a reminder as completed",
      inputSchema: {
        listName: listNameField,
        name: z.string().optional().describe("Exact name of the reminder to complete"),
        id: reminderIdField,
      },
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
      inputSchema: {
        listName: listNameField,
        name: z.string().optional().describe("Exact name of the reminder to delete"),
        id: reminderIdField,
      },
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
        "Search for reminders by name across all lists. Returns only incomplete reminders by default.",
      inputSchema: {
        query: z.string().describe("Search term to match in reminder names"),
        includeCompleted: z
          .boolean()
          .default(false)
          .describe("Include completed reminders in search"),
      },
    },
    async (input) => jsonResult(await reminders.search(input)),
  );
}
