import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult, jsonResult, linesResult } from "./results.ts";
import { createNotes, type Notes } from "./notes.ts";
import {
  listNotesInput,
  readNoteInput,
  createNoteInput,
  searchNotesInput,
  moveNoteInput,
  editNoteInput,
  deleteNoteInput,
} from "./notes.inputs.ts";

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
      inputSchema: listNotesInput.shape,
    },
    async (input) => linesResult(await notes.list(input), "No notes found."),
  );

  server.registerTool(
    "notes_read",
    {
      title: "Read Note",
      description:
        "Read the content of a note by its exact name. Returns HTML by default to preserve formatting.",
      inputSchema: readNoteInput.shape,
    },
    async (input) => textResult(await notes.read(input)),
  );

  server.registerTool(
    "notes_create",
    {
      title: "Create Note",
      description:
        "Create a new note in Apple Notes. Body supports markdown which is auto-converted to formatted HTML.",
      inputSchema: createNoteInput.shape,
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
      inputSchema: searchNotesInput.shape,
    },
    async (input) => jsonResult(await notes.search(input)),
  );

  server.registerTool(
    "notes_move",
    {
      title: "Move Note",
      description: "Move a note to a different folder",
      inputSchema: moveNoteInput.shape,
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
      inputSchema: editNoteInput.shape,
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
      inputSchema: deleteNoteInput.shape,
    },
    async (input) => {
      await notes.delete(input);
      return textResult(`Deleted note "${input.name}".`);
    },
  );
}
