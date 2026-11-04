import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAppleScript,
  runNameList,
  parseList,
  deleteFirstMatching,
  quoted,
  joinLinefeedScript,
  scopeExpression,
  type RunScript,
} from "./osascript.ts";
import { textResult, jsonResult, linesResult } from "./results.ts";
import { markdownToHtml, MARKDOWN_SYNTAX_DESCRIPTION } from "./markdown.ts";

// Bulk lists cost two Apple Events per folder; per-note property reads cost
// one round trip per property per note.
function notesListScript(folder?: string): string {
  return `
tell application "Notes"
  set outputLines to {}
  repeat with f in ${scopeExpression("folder", folder)}
    set folderName to name of f
    set nameList to name of every note of f
    set dateList to modification date of every note of f
    repeat with i from 1 to count of nameList
      set end of outputLines to (item i of nameList & " | folder: " & folderName & " | modified: " & (item i of dateList as text))
    end repeat
  end repeat
  ${joinLinefeedScript("outputLines")}
end tell`;
}

export type Notes = {
  listFolders(): Promise<string[]>;
  list(input: { folder?: string }): Promise<string[]>;
  read(input: { name: string; html?: boolean }): Promise<string>;
  create(input: { title: string; body: string; folder?: string }): Promise<void>;
  search(input: {
    query: string;
    searchContent?: boolean;
    folder?: string;
  }): Promise<string[]>;
  move(input: { name: string; targetFolder: string }): Promise<void>;
  edit(input: { name: string; title?: string; body?: string }): Promise<void>;
  delete(input: { name: string }): Promise<void>;
};

export function createNotes(run: RunScript = runAppleScript): Notes {
  return {
    listFolders: () => runNameList(run, "Notes", "name of every folder"),

    async list({ folder }) {
      return parseList(await run(notesListScript(folder)));
    },

    read({ name, html = true }) {
      const prop = html ? "body" : "plaintext";
      return run(
        `tell application "Notes" to ${prop} of first note whose name is ${quoted(name)}`,
      );
    },

    async create({ title, body, folder }) {
      const target = folder ? `tell folder ${quoted(folder)} to ` : "";
      await run(
        `tell application "Notes" to ${target}make new note with properties {name:${quoted(title)}, body:${quoted(markdownToHtml(body))}}`,
      );
    },

    search({ query, searchContent = false, folder }) {
      const field = searchContent ? "plaintext" : "name";
      const scope = folder
        ? `every note in folder ${quoted(folder)}`
        : "every note";
      return runNameList(
        run,
        "Notes",
        `name of (${scope} whose ${field} contains ${quoted(query)})`,
      );
    },

    async move({ name, targetFolder }) {
      await run(
        `tell application "Notes" to move (first note whose name is ${quoted(name)}) to folder ${quoted(targetFolder)}`,
      );
    },

    async edit({ name, title, body }) {
      if (title === undefined && body === undefined) {
        throw new Error("Nothing to update. Provide a title, body, or both.");
      }
      const lines = [
        `tell application "Notes"`,
        `  set n to first note whose name is ${quoted(name)}`,
      ];
      if (body !== undefined)
        lines.push(`  set body of n to ${quoted(markdownToHtml(body))}`);
      if (title !== undefined) lines.push(`  set name of n to ${quoted(title)}`);
      lines.push("end tell");
      await run(lines.join("\n"));
    },

    async delete({ name }) {
      await run(`tell application "Notes"
  ${deleteFirstMatching("note", `name is ${quoted(name)}`)}
end tell`);
    },
  };
}

export function registerNotesTools(
  server: McpServer,
  notes: Notes = createNotes(),
) {
  server.registerTool(
    "notes_list_folders",
    {
      title: "List Note Folders",
      description: "Get all folder names from Apple Notes",
    },
    async () => jsonResult(await notes.listFolders()),
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
    async (input) => linesResult(await notes.list(input), "No notes found."),
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
    async (input) => textResult(await notes.read(input)),
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
    async (input) => {
      await notes.create(input);
      return textResult(
        `Created note "${input.title}"${input.folder ? ` in folder "${input.folder}"` : ""}.`,
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
    async (input) => jsonResult(await notes.search(input)),
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
    async (input) => {
      await notes.move(input);
      return textResult(
        `Moved note "${input.name}" to folder "${input.targetFolder}".`,
      );
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
    async (input) => {
      await notes.edit(input);
      return textResult(`Updated note "${input.name}".`);
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
    async (input) => {
      await notes.delete(input);
      return textResult(`Deleted note "${input.name}".`);
    },
  );
}
