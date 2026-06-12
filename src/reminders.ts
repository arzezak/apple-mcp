import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAppleScript,
  parseList,
  nameListScript,
  esc,
  textResult,
  appleScriptDateLiteral,
} from "./osascript.ts";

export function registerRemindersTools(server: McpServer) {
  server.registerTool(
    "reminders_list_lists",
    {
      title: "List Reminder Lists",
      description: "Get all reminder list names from Apple Reminders",
    },
    async () => {
      const raw = await runAppleScript(
        nameListScript("Reminders", "name of every list"),
      );
      return textResult(JSON.stringify(parseList(raw), null, 2));
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
      const filter = includeCompleted ? "" : " whose completed is false";
      const script = `tell application "Reminders"
  tell list "${esc(listName)}"
    set nameList to name of every reminder${filter}
    set bodyList to body of every reminder${filter}
    set dueDateList to due date of every reminder${filter}
    set priorityList to priority of every reminder${filter}
  end tell
  set output to ""
  repeat with i from 1 to count of nameList
    set line_ to "- " & item i of nameList
    try
      set d to item i of dueDateList
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
    set output to output & line_ & linefeed
  end repeat
  output
end tell`;
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
        priority: z
          .number()
          .min(0)
          .max(9)
          .optional()
          .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
      },
    },
    async ({ listName, name, notes, dueDate, priority }) => {
      const props: string[] = [`name:"${esc(name)}"`];
      if (notes) props.push(`body:"${esc(notes)}"`);
      if (dueDate) props.push(`due date:${appleScriptDateLiteral(dueDate)}`);
      if (priority !== undefined) props.push(`priority:${priority}`);

      const script = `tell application "Reminders" to tell list "${esc(listName)}" to make new reminder with properties {${props.join(", ")}}`;
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
      const filter = includeCompleted
        ? `whose name contains "${esc(query)}"`
        : `whose name contains "${esc(query)}" and completed is false`;
      const raw = await runAppleScript(
        nameListScript("Reminders", `name of (every reminder ${filter})`),
      );
      return textResult(JSON.stringify(parseList(raw), null, 2));
    },
  );
}
