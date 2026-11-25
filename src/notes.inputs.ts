import { z } from "zod";
import { MARKDOWN_SYNTAX_DESCRIPTION } from "./markdown.ts";

export const listNotesInput = z.object({
  folder: z
    .string()
    .optional()
    .describe("Folder name. Omit to list from all folders."),
});

export const readNoteInput = z.object({
  name: z.string().describe("Exact name of the note"),
  html: z
    .boolean()
    .default(true)
    .describe("Return HTML (default) or plain text"),
});

export const createNoteInput = z.object({
  title: z.string().describe("Note title"),
  body: z.string().describe(`Note body. ${MARKDOWN_SYNTAX_DESCRIPTION}`),
  folder: z
    .string()
    .optional()
    .describe("Folder name. Omit for default folder."),
});

export const searchNotesInput = z.object({
  query: z.string().describe("Search term"),
  searchContent: z
    .boolean()
    .default(false)
    .describe("Search note body text too, not just titles"),
  folder: z
    .string()
    .optional()
    .describe("Scope search to a specific folder"),
});

export const moveNoteInput = z.object({
  name: z.string().describe("Exact name of the note to move"),
  targetFolder: z.string().describe("Destination folder name"),
});

export const editNoteInput = z.object({
  name: z.string().describe("Exact current name of the note"),
  title: z.string().optional().describe("New title for the note"),
  body: z
    .string()
    .optional()
    .describe(`New body content. ${MARKDOWN_SYNTAX_DESCRIPTION}`),
});

export const deleteNoteInput = z.object({
  name: z.string().describe("Exact name of the note to delete"),
});

export type ListNotesInput = z.input<typeof listNotesInput>;
export type ReadNoteInput = z.input<typeof readNoteInput>;
export type CreateNoteInput = z.input<typeof createNoteInput>;
export type SearchNotesInput = z.input<typeof searchNotesInput>;
export type MoveNoteInput = z.input<typeof moveNoteInput>;
export type EditNoteInput = z.input<typeof editNoteInput>;
export type DeleteNoteInput = z.input<typeof deleteNoteInput>;
