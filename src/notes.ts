import { runAppleScript, quoted, type RunScript } from "./osascript.ts";
import {
  runNameList,
  parseList,
  joinLinefeedScript,
  scopeExpression,
} from "./lists.ts";
import { deleteFirstMatching } from "./matching.ts";
import { escapeHtml, markdownToHtml } from "./markdown.ts";
import type {
  CreateNoteInput,
  DeleteNoteInput,
  EditNoteInput,
  ListNotesInput,
  MoveNoteInput,
  ReadNoteInput,
  SearchNotesInput,
} from "./notes.inputs.ts";

// Bulk lists cost two Apple Events per folder; per-note property reads cost
// one round trip per property per note.
function notesListScript(folder?: string): string {
  return `
tell application "Notes"
  set outputLines to {}
  repeat with currentFolder in ${scopeExpression("folder", folder)}
    set folderName to name of currentFolder
    set nameList to name of every note of currentFolder
    set dateList to modification date of every note of currentFolder
    repeat with noteIndex from 1 to count of nameList
      set end of outputLines to (item noteIndex of nameList & " | folder: " & folderName & " | modified: " & (item noteIndex of dateList as text))
    end repeat
  end repeat
  ${joinLinefeedScript("outputLines")}
end tell`;
}

export type Notes = {
  listFolders(): Promise<string[]>;
  list(input: ListNotesInput): Promise<string[]>;
  read(input: ReadNoteInput): Promise<string>;
  create(input: CreateNoteInput): Promise<void>;
  search(input: SearchNotesInput): Promise<string[]>;
  move(input: MoveNoteInput): Promise<void>;
  edit(input: EditNoteInput): Promise<void>;
  delete(input: DeleteNoteInput): Promise<void>;
};

export function createNotes(run: RunScript = runAppleScript): Notes {
  return {
    listFolders: () => runNameList(run, "Notes", "name of every folder"),

    async list({ folder }) {
      return parseList(await run(notesListScript(folder)));
    },

    // Notes returns an empty body for a locked note instead of an error.
    async read({ name, html = true }) {
      const property = html ? "body" : "plaintext";
      const note = `first note whose name is ${quoted(name)}`;
      const content = await run(`tell application "Notes" to ${property} of ${note}`);

      if (content !== "") return content;

      const locked = await run(
        `tell application "Notes" to password protected of ${note}`,
      );

      if (locked === "true") {
        throw new Error(`Note "${name}" is locked. Unlock it in Notes to read it.`);
      }

      return content;
    },

    async create({ title, body, folder }) {
      const target = folder ? `tell folder ${quoted(folder)} to ` : "";

      await run(
        `tell application "Notes" to ${target}make new note with properties {name:${quoted(title)}, body:${quoted(markdownToHtml(body))}}`,
      );
    },

    // Title matches are filtered here: `whose name contains` took 4.3-5.1s
    // on 310 notes against 0.19s for every name (2026-11-25).
    async search({ query, searchContent = false, folder }) {
      const scope = folder
        ? `every note in folder ${quoted(folder)}`
        : "every note";

      if (searchContent) {
        return runNameList(
          run,
          "Notes",
          `name of (${scope} whose plaintext contains ${quoted(query)})`,
        );
      }

      const loweredQuery = query.toLowerCase();
      const names = await runNameList(run, "Notes", `name of ${scope}`);

      return names.filter((name) => name.toLowerCase().includes(loweredQuery));
    },

    async move({ name, targetFolder }) {
      await run(
        `tell application "Notes" to move (first note whose name is ${quoted(name)}) to folder ${quoted(targetFolder)}`,
      );
    },

    // Notes shows the first line of the body as the note's name, so a new
    // body carries the title as its first line.
    async edit({ name, title, body }) {
      if (title === undefined && body === undefined) {
        throw new Error("Nothing to update. Provide a title, body, or both.");
      }

      if (title === "") throw new Error("Title cannot be empty.");

      const lines = [
        `tell application "Notes"`,
        `  set targetNote to first note whose name is ${quoted(name)}`,
      ];

      if (body !== undefined) {
        const titleLine = `<div>${escapeHtml(title ?? name)}</div>`;

        lines.push(`  set body of targetNote to ${quoted(`${titleLine}\n${markdownToHtml(body)}`)}`);
      } else {
        lines.push(`  set name of targetNote to ${quoted(title!)}`);
      }

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
