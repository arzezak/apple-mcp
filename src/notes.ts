import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, runNameList, esc } from "./osascript.ts";
import { textResult, jsonResult } from "./results.ts";
import { markdownToHtml, MARKDOWN_SYNTAX_DESCRIPTION } from "./markdown.ts";

// Fetches names and dates as bulk lists (two Apple Events per folder) instead
// of reading properties per note in the loop, which costs one round trip per
// property per note.
function buildNotesListScript(folder?: string): string {
  const foldersExpression = folder
    ? `{folder "${esc(folder)}"}`
    : "every folder";

  return `
tell application "Notes"
  set outputLines to {}
  repeat with f in ${foldersExpression}
    set folderName to name of f
    set nameList to name of every note of f
    set dateList to modification date of every note of f
    repeat with i from 1 to count of nameList
      set end of outputLines to (item i of nameList & " | folder: " & folderName & " | modified: " & (item i of dateList as text))
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  outputLines as text
end tell`;
}

export function registerNotesTools(server: McpServer) {
  server.registerTool(
    "notes_list_folders",
    {
      title: "List Note Folders",
      description: "Get all folder names from Apple Notes",
    },
    async () => {
      return jsonResult(await runNameList("Notes", "name of every folder"));
    },
  );

  server.registerTool(
    "notes_list",
    {
      title: "List Notes",
      description:
        "List notes in a folder with name and modification date. If no folder specified, lists from all folders.",
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe("Folder name. Omit to list from all folders."),
      },
    },
    async ({ folder }) => {
      const raw = await runAppleScript(buildNotesListScript(folder));
      return textResult(raw || "No notes found.");
    },
  );

  server.registerTool(
    "notes_read",
    {
      title: "Read Note",
      description:
        "Read the content of a note by its exact name. Returns HTML by default to preserve formatting.",
      inputSchema: {
        name: z.string().describe("Exact name of the note"),
        html: z
          .boolean()
          .default(true)
          .describe("Return HTML (default) or plain text"),
      },
    },
    async ({ name, html }) => {
      const prop = html ? "body" : "plaintext";
      const script = `tell application "Notes" to ${prop} of first note whose name is "${esc(name)}"`;
      const raw = await runAppleScript(script);
      return textResult(raw);
    },
  );

  server.registerTool(
    "notes_create",
    {
      title: "Create Note",
      description:
        "Create a new note in Apple Notes. Body supports markdown which is auto-converted to formatted HTML.",
      inputSchema: {
        title: z.string().describe("Note title"),
        body: z.string().describe(`Note body. ${MARKDOWN_SYNTAX_DESCRIPTION}`),
        folder: z
          .string()
          .optional()
          .describe("Folder name. Omit for default folder."),
      },
    },
    async ({ title, body, folder }) => {
      const htmlBody = markdownToHtml(body);
      const target = folder ? `tell folder "${esc(folder)}" to ` : "";
      const script = `tell application "Notes" to ${target}make new note with properties {name:"${esc(title)}", body:"${esc(htmlBody)}"}`;
      await runAppleScript(script);
      return textResult(
        `Created note "${title}"${folder ? ` in folder "${folder}"` : ""}.`,
      );
    },
  );

  server.registerTool(
    "notes_search",
    {
      title: "Search Notes",
      description:
        "Search notes by name or content. Scoping to a folder is faster.",
      inputSchema: {
        query: z.string().describe("Search term"),
        searchContent: z
          .boolean()
          .default(false)
          .describe("Search note body text too, not just titles"),
        folder: z
          .string()
          .optional()
          .describe("Scope search to a specific folder"),
      },
    },
    async ({ query, searchContent, folder }) => {
      const field = searchContent ? "plaintext" : "name";
      const scope = folder
        ? `every note in folder "${esc(folder)}"`
        : "every note";
      return jsonResult(
        await runNameList(
          "Notes",
          `name of (${scope} whose ${field} contains "${esc(query)}")`,
        ),
      );
    },
  );

  server.registerTool(
    "notes_move",
    {
      title: "Move Note",
      description: "Move a note to a different folder",
      inputSchema: {
        name: z.string().describe("Exact name of the note to move"),
        targetFolder: z.string().describe("Destination folder name"),
      },
    },
    async ({ name, targetFolder }) => {
      const script = `tell application "Notes" to move (first note whose name is "${esc(name)}") to folder "${esc(targetFolder)}"`;
      await runAppleScript(script);
      return textResult(`Moved note "${name}" to folder "${targetFolder}".`);
    },
  );

  server.registerTool(
    "notes_edit",
    {
      title: "Edit Note",
      description:
        "Update a note's title, body, or both. Finds the note by its exact current name.",
      inputSchema: {
        name: z.string().describe("Exact current name of the note"),
        title: z.string().optional().describe("New title for the note"),
        body: z
          .string()
          .optional()
          .describe(`New body content. ${MARKDOWN_SYNTAX_DESCRIPTION}`),
      },
    },
    async ({ name, title, body }) => {
      if (!title && !body) {
        return textResult("Nothing to update. Provide a title, body, or both.");
      }
      const lines = [
        `tell application "Notes"`,
        `  set n to first note whose name is "${esc(name)}"`,
      ];
      if (body !== undefined)
        lines.push(`  set body of n to "${esc(markdownToHtml(body))}"`);
      if (title !== undefined) lines.push(`  set name of n to "${esc(title)}"`);
      lines.push("end tell");
      await runAppleScript(lines.join("\n"));
      return textResult(`Updated note "${name}".`);
    },
  );

  server.registerTool(
    "notes_delete",
    {
      title: "Delete Note",
      description: "Delete a note by its exact name",
      inputSchema: {
        name: z.string().describe("Exact name of the note to delete"),
      },
    },
    async ({ name }) => {
      const script = `tell application "Notes" to delete (first note whose name is "${esc(name)}")`;
      await runAppleScript(script);
      return textResult(`Deleted note "${name}".`);
    },
  );
}
