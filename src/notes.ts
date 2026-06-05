import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, runAppleScriptMultiline, parseList } from "./osascript.js";

export function registerNotesTools(server: McpServer) {
  // ── List folders ─────────────────────────────────────────────────────
  server.registerTool(
    "notes_list_folders",
    {
      title: "List Note Folders",
      description: "Get all folder names from Apple Notes",
    },
    async () => {
      const raw = await runAppleScript(
        'tell application "Notes" to name of every folder'
      );
      const folders = parseList(raw);
      return {
        content: [{ type: "text", text: JSON.stringify(folders, null, 2) }],
      };
    }
  );

  // ── List notes in a folder ───────────────────────────────────────────
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
      const scope = folder
        ? `every note in folder "${esc(folder)}"`
        : "every note";
      const script = `
tell application "Notes"
  set output to ""
  repeat with n in (${scope})
    set output to output & name of n & " | folder: " & name of container of n & " | modified: " & (modification date of n as text) & linefeed
  end repeat
  output
end tell`;
      const raw = await runAppleScriptMultiline(script);
      return { content: [{ type: "text", text: raw || "No notes found." }] };
    }
  );

  // ── Read a note ──────────────────────────────────────────────────────
  server.registerTool(
    "notes_read",
    {
      title: "Read Note",
      description:
        "Read the content of a note by its exact name. Returns plain text by default.",
      inputSchema: {
        name: z.string().describe("Exact name of the note"),
        html: z
          .boolean()
          .default(false)
          .describe("Return raw HTML instead of plain text"),
      },
    },
    async ({ name, html }) => {
      const prop = html ? "body" : "plaintext";
      const script = `tell application "Notes" to ${prop} of first note whose name is "${esc(name)}"`;
      const raw = await runAppleScript(script);
      return { content: [{ type: "text", text: raw }] };
    }
  );

  // ── Create a note ────────────────────────────────────────────────────
  server.registerTool(
    "notes_create",
    {
      title: "Create Note",
      description:
        "Create a new note in Apple Notes. Body can be plain text or HTML.",
      inputSchema: {
        title: z.string().describe("Note title"),
        body: z.string().describe("Note body (plain text or HTML)"),
        folder: z
          .string()
          .optional()
          .describe("Folder name. Omit for default folder."),
      },
    },
    async ({ title, body, folder }) => {
      const target = folder
        ? `tell folder "${esc(folder)}" to `
        : "";
      const script = `tell application "Notes" to ${target}make new note with properties {name:"${esc(title)}", body:"${esc(body)}"}`;
      await runAppleScript(script);
      return {
        content: [
          {
            type: "text",
            text: `Created note "${title}"${folder ? ` in folder "${folder}"` : ""}.`,
          },
        ],
      };
    }
  );

  // ── Search notes ─────────────────────────────────────────────────────
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
      const script = `tell application "Notes" to name of (${scope} whose ${field} contains "${esc(query)}")`;
      const raw = await runAppleScript(script);
      const results = parseList(raw);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // ── Move a note ──────────────────────────────────────────────────────
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
      return {
        content: [
          { type: "text", text: `Moved note "${name}" to folder "${targetFolder}".` },
        ],
      };
    }
  );

  // ── Delete a note ────────────────────────────────────────────────────
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
      return {
        content: [{ type: "text", text: `Deleted note "${name}".` }],
      };
    }
  );
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
