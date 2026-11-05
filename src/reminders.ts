import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runAppleScript,
  runNameList,
  matchClause,
  matchLabel,
  deleteFirstMatching,
  requireMatching,
  parseList,
  quoted,
  appleScriptDateLiteral,
  hasTimeComponent,
  joinLinefeedScript,
  scopeExpression,
  SLOW_QUERY_TIMEOUT_MS,
  type RunScript,
} from "./osascript.ts";
import { jsonResult, linesResult, textResult } from "./results.ts";
import {
  recurrenceSchema,
  recurrenceRule,
  recurrenceUntilDate,
  type Recurrence,
} from "./recurrence.ts";

const PROPERTY_LIST_VARS = {
  name: "nameList",
  "due date": "dueDateList",
  "allday due date": "allDayDueDateList",
  priority: "priorityList",
  body: "bodyList",
  id: "idList",
} as const;

type ReminderProperty = keyof typeof PROPERTY_LIST_VARS;

function reminderLineStatements(
  read: (property: ReminderProperty) => string,
  prefix = '"- "',
): string {
  return `set line_ to ${prefix} & ${read("name")}
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
      if b is not missing value and b is not "" then
        set AppleScript's text item delimiters to {return & linefeed, return, linefeed}
        set b to text items of b
        set AppleScript's text item delimiters to " / "
        set line_ to line_ & " | notes: " & (b as text)
      end if
    end try
    set line_ to line_ & " | id: " & ${read("id")}
    set end of outputLines to line_`;
}

// Fastest measured shape when filtering: per-property fetches would
// re-evaluate the completed filter once per property. Scoped to one list for
// reminders_list; across every list for reminders_search, where each line
// carries the list name that reminders_complete and reminders_delete need
// (~2x an app-wide name-only query: 32s vs 16s warm on 10 lists, 2026-11-04).
function incompleteRemindersScript({
  listName,
  query,
}: {
  listName?: string;
  query?: string;
}): string {
  const filter =
    "completed is false" + (query ? ` and name contains ${quoted(query)}` : "");
  const prefix = listName ? '"- "' : '(name of l) & ": "';
  return `tell application "Reminders"
  set outputLines to {}
  repeat with l in ${scopeExpression("list", listName)}
    set recordList to properties of (every reminder of l whose ${filter})
    repeat with r in recordList
      ${reminderLineStatements((property) => `${property} of r`, prefix)}
    end repeat
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
    set idList to id of every reminder
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
    const [property, value] = dueDateAssignment(dueDate, allDay);
    props.push(`${property}:${value}`);
  }
  if (priority !== undefined) props.push(`priority:${priority}`);

  return `tell application "Reminders" to tell list ${quoted(listName)} to make new reminder with properties {${props.join(", ")}}`;
}

function dueDateAssignment(dueDate: string, allDay?: boolean): [string, string] {
  const property =
    allDay || !hasTimeComponent(dueDate) ? "allday due date" : "due date";
  return [property, appleScriptDateLiteral(dueDate)];
}

function reminderUpdateScript(
  listName: string,
  clause: string,
  { title, notes, dueDate, allDay, priority }: ReminderChanges,
): string {
  const sets: string[] = [];
  if (title !== undefined) sets.push(`set name to ${quoted(title)}`);
  if (notes !== undefined) sets.push(`set body to ${quoted(notes)}`);
  if (dueDate !== undefined) {
    const [property, value] = dueDateAssignment(dueDate, allDay);
    sets.push(`set ${property} to ${value}`);
  }
  if (priority !== undefined) sets.push(`set priority to ${priority}`);
  if (sets.length === 0) {
    throw new Error("Nothing to update. Provide a title, notes, dueDate or priority.");
  }
  return `tell application "Reminders" to tell list ${quoted(listName)}
  ${requireMatching("reminder", clause)}
  tell (first reminder whose ${clause})
    ${sets.join("\n    ")}
  end tell
end tell`;
}

const EK_FREQUENCY = { daily: 0, weekly: 1, monthly: 2, yearly: 3 } as const;

// Reminders' AppleScript dictionary has no recurrence, so the rule is attached
// through EventKit (JXA). The UUID in the AppleScript id is the EventKit
// calendarItemIdentifier (checked 2026-11-05). The bridge returns the
// authorization status as a string, hence Number().
function reminderRecurrenceScript(id: string, recurrence: Recurrence): string {
  const uuid = id.replace(/^x-apple-reminder:\/\//, "");
  const end =
    recurrence.count !== undefined
      ? `$.EKRecurrenceEnd.recurrenceEndWithOccurrenceCount(${recurrence.count})`
      : recurrence.until !== undefined
        ? `$.EKRecurrenceEnd.recurrenceEndWithEndDate($.NSDate.dateWithTimeIntervalSince1970(${recurrenceUntilDate(recurrence.until).getTime() / 1000}))`
        : "$()";
  return `ObjC.import("EventKit");
const store = $.EKEventStore.alloc.init;
const status = () => Number($.EKEventStore.authorizationStatusForEntityType(1));
if (status() === 0) {
  store.requestFullAccessToRemindersWithCompletion(() => {});
  const deadline = Date.now() + 60000;
  while (status() === 0 && Date.now() < deadline)
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
}
if (status() !== 3)
  throw new Error("osascript has no Reminders access. Allow it under System Settings > Privacy & Security > Reminders.");
const item = store.calendarItemWithIdentifier(${JSON.stringify(uuid)});
if (item.isNil()) throw new Error(${JSON.stringify(`No reminder with id ${id}.`)});
item.addRecurrenceRule($.EKRecurrenceRule.alloc.initRecurrenceWithFrequencyIntervalEnd(${EK_FREQUENCY[recurrence.frequency]}, ${recurrence.interval}, ${end}));
const error = Ref();
if (!store.saveReminderCommitError(item, true, error)) throw new Error(ObjC.unwrap(error[0].localizedDescription));`;
}

// Parsed from the make result because reading any property of a just-made
// reminder in-script blocks ~13s (measured 2026-11-04).
function parseReminderId(raw: string): string {
  const id = /x-apple-reminder:\/\/[^\s"]+/.exec(raw)?.[0];
  if (!id) throw new Error(`No reminder id in AppleScript result: ${raw}`);
  return id;
}

export type ReminderMatch = { listName: string; name?: string; id?: string };

export type ReminderChanges = {
  title?: string;
  notes?: string;
  dueDate?: string;
  allDay?: boolean;
  priority?: number;
};

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
    recurrence?: Recurrence;
  }): Promise<{ id: string; recurrenceRule?: string }>;
  update(input: ReminderMatch & ReminderChanges): Promise<void>;
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
        : incompleteRemindersScript({ listName });
      return parseList(await run(script));
    },

    async create({ recurrence, ...input }) {
      const rule = recurrence && recurrenceRule(recurrence);
      const id = parseReminderId(await run(reminderCreateScript(input)));
      if (recurrence) {
        try {
          await run(reminderRecurrenceScript(id, recurrence), undefined, "JavaScript");
        } catch (error) {
          throw new Error(
            `Created reminder "${input.name}" (id: ${id}) but could not attach the recurrence: ${(error as Error).message}`,
          );
        }
      }
      return { id, recurrenceRule: rule };
    },

    async update({ listName, name, id, ...changes }) {
      const { clause } = matchClause({ nameProperty: "name", name, id });
      await run(reminderUpdateScript(listName, clause, changes));
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

    // Full records for completed reminders across every list took 136s
    // (2026-11-04), so that mode returns names only.
    async search({ query, includeCompleted = false }) {
      if (includeCompleted) {
        return runNameList(
          run,
          "Reminders",
          `name of (every reminder whose name contains ${quoted(query)})`,
          SLOW_QUERY_TIMEOUT_MS,
        );
      }
      return parseList(
        await run(incompleteRemindersScript({ query }), SLOW_QUERY_TIMEOUT_MS),
      );
    },
  };
}

const listNameField = z.string().describe("Name of the reminder list");
const reminderIdField = z
  .string()
  .optional()
  .describe("Reminder id as returned by reminders_create, reminders_list or reminders_search; use instead of name");

const dueDateField = z
  .string()
  .optional()
  .describe(
    'Due date string in locale format, e.g. "2026-06-10 09:00:00" or "June 10, 2026 9:00 AM"',
  );
const priorityField = z
  .number()
  .min(0)
  .max(9)
  .optional()
  .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low");

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
        "List reminders in a specific list. Returns name, due date, priority, notes, and id for each.",
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
        dueDate: dueDateField,
        allDay: z
          .boolean()
          .default(false)
          .describe(
            "Create with an all-day due date. Date-only dueDate values are treated as all-day even when this is false.",
          ),
        priority: priorityField,
        recurrence: recurrenceSchema
          .optional()
          .describe(
            'Optional recurrence rule, same shape as calendar_create_event. Example: {"frequency":"monthly","interval":1} repeats every month.',
          ),
      },
    },
    async (input) => {
      const { id, recurrenceRule } = await reminders.create(input);
      const suffix = recurrenceRule ? ` with recurrence ${recurrenceRule}` : "";
      return textResult(
        `Created reminder "${input.name}" in list "${input.listName}"${suffix} (id: ${id}).`,
      );
    },
  );

  server.registerTool(
    "reminders_update",
    {
      title: "Update Reminder",
      description:
        "Change a reminder's title, notes, due date or priority in place. Finds it by exact name or by id.",
      inputSchema: {
        listName: listNameField,
        name: z.string().optional().describe("Exact current name of the reminder"),
        id: reminderIdField,
        title: z.string().optional().describe("New title"),
        notes: z.string().optional().describe("New notes/body"),
        dueDate: dueDateField,
        allDay: z
          .boolean()
          .optional()
          .describe("With dueDate: make it an all-day due date"),
        priority: priorityField,
      },
    },
    async (input) => {
      await reminders.update(input);
      return textResult(`Updated reminder ${matchLabel(input)}.`);
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
        "Search for reminders by name across all lists. Returns only incomplete reminders by default, one line each with list name, due date, priority, notes, and id. With includeCompleted, returns names only.",
      inputSchema: {
        query: z.string().describe("Search term to match in reminder names"),
        includeCompleted: z
          .boolean()
          .default(false)
          .describe("Include completed reminders in search"),
      },
    },
    async (input) => linesResult(await reminders.search(input), "No reminders found."),
  );
}
