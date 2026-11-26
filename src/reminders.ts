import {
  runAppleScript,
  quoted,
  SLOW_QUERY_TIMEOUT_MS,
  type RunScript,
} from "./osascript.ts";
import {
  runNameList,
  parseList,
  joinLinefeedScript,
  scopeExpression,
} from "./lists.ts";
import { appleScriptDateStatements, hasTimeComponent } from "./dates.ts";
import { whoseClause, deleteFirstMatching, requireMatching } from "./matching.ts";
import {
  recurrenceRule,
  recurrenceUntilDate,
  type Recurrence,
} from "./recurrence.ts";
import { eventStoreStatements } from "./eventkit.ts";
import type {
  CreateReminderInput,
  ListRemindersInput,
  ReminderChanges,
  ReminderMatch,
  SearchRemindersInput,
  UpdateReminderInput,
} from "./reminders.inputs.ts";

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
  return `set outputLine to ${prefix} & ${read("name")}
    try
      set dueValue to ${read("due date")}
      if dueValue is missing value then set dueValue to ${read("allday due date")}
      if dueValue is not missing value then set outputLine to outputLine & " | due: " & (dueValue as text)
    end try
    try
      set priorityValue to ${read("priority")}
      if priorityValue is not 0 then set outputLine to outputLine & " | priority: " & priorityValue
    end try
    try
      set noteText to ${read("body")}
      if noteText is not missing value and noteText is not "" then
        set AppleScript's text item delimiters to {return & linefeed, return, linefeed}
        set noteLines to text items of noteText
        set AppleScript's text item delimiters to " / "
        set outputLine to outputLine & " | notes: " & (noteLines as text)
      end if
    end try
    set outputLine to outputLine & " | id: " & ${read("id")}
    set end of outputLines to outputLine`;
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

  const prefix = listName ? '"- "' : '(name of currentList) & ": "';

  return `tell application "Reminders"
  set outputLines to {}
  repeat with currentList in ${scopeExpression("list", listName)}
    set recordList to properties of (every reminder of currentList whose ${filter})
    repeat with reminderRecord in recordList
      ${reminderLineStatements((property) => `${property} of reminderRecord`, prefix)}
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
  repeat with reminderIndex from 1 to count of nameList
    ${reminderLineStatements((property) => `item reminderIndex of ${PROPERTY_LIST_VARS[property]}`)}
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
}: Omit<CreateReminderInput, "recurrence">): string {
  const properties: string[] = [`name:${quoted(name)}`];
  if (notes) properties.push(`body:${quoted(notes)}`);
  if (dueDate) properties.push(`${dueDateProperty(dueDate, allDay)}:theDueDate`);
  if (priority !== undefined) properties.push(`priority:${priority}`);

  return `${dueDateSetup(dueDate)}tell application "Reminders" to tell list ${quoted(listName)} to make new reminder with properties {${properties.join(", ")}}`;
}

function dueDateProperty(dueDate: string, allDay?: boolean): string {
  return allDay || !hasTimeComponent(dueDate) ? "allday due date" : "due date";
}

function dueDateSetup(dueDate?: string): string {
  if (!dueDate) return "";

  return `${appleScriptDateStatements("theDueDate", dueDate)}\n`;
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
    sets.push(`set ${dueDateProperty(dueDate, allDay)} to theDueDate`);
  }

  if (priority !== undefined) sets.push(`set priority to ${priority}`);

  if (sets.length === 0) {
    throw new Error("Nothing to update. Provide a title, notes, dueDate or priority.");
  }

  return `${dueDateSetup(dueDate)}tell application "Reminders" to tell list ${quoted(listName)}
  ${requireMatching("reminder", clause)}
  tell (first reminder whose ${clause})
    ${sets.join("\n    ")}
  end tell
end tell`;
}

const EK_FREQUENCY = { daily: 0, weekly: 1, monthly: 2, yearly: 3 } as const;

// Reminders' AppleScript dictionary has no recurrence, so the rule is attached
// through EventKit (JXA). The UUID in the AppleScript id is the EventKit
// calendarItemIdentifier (checked 2026-11-05).
function reminderRecurrenceScript(id: string, recurrence: Recurrence): string {
  const uuid = id.replace(/^x-apple-reminder:\/\//, "");

  const end =
    recurrence.count !== undefined
      ? `$.EKRecurrenceEnd.recurrenceEndWithOccurrenceCount(${recurrence.count})`
      : recurrence.until !== undefined
        ? `$.EKRecurrenceEnd.recurrenceEndWithEndDate($.NSDate.dateWithTimeIntervalSince1970(${recurrenceUntilDate(recurrence.until).getTime() / 1000}))`
        : "$()";

  return `${eventStoreStatements("reminders")}
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

export type Reminders = {
  listLists(): Promise<string[]>;
  list(input: ListRemindersInput): Promise<string[]>;
  create(input: CreateReminderInput): Promise<{ id: string; recurrenceRule?: string }>;
  update(input: UpdateReminderInput): Promise<void>;
  complete(match: ReminderMatch): Promise<void>;
  delete(match: ReminderMatch): Promise<void>;
  search(input: SearchRemindersInput): Promise<string[]>;
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
          await run(reminderRecurrenceScript(id, recurrence), { language: "JavaScript" });
        } catch (error) {
          throw new Error(
            `Created reminder "${input.name}" (id: ${id}) but could not attach the recurrence: ${(error as Error).message}`,
          );
        }
      }

      return { id, recurrenceRule: rule };
    },

    async update({ listName, name, id, ...changes }) {
      const clause = whoseClause({ nameProperty: "name", name, id });
      await run(reminderUpdateScript(listName, clause, changes));
    },

    async complete({ listName, name, id }) {
      const clause = whoseClause({ nameProperty: "name", name, id });

      await run(
        `tell application "Reminders" to tell list ${quoted(listName)} to set completed of (first reminder whose ${clause}) to true`,
      );
    },

    async delete({ listName, name, id }) {
      const clause = whoseClause({ nameProperty: "name", name, id });

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
          { timeoutMs: SLOW_QUERY_TIMEOUT_MS },
        );
      }

      return parseList(
        await run(incompleteRemindersScript({ query }), { timeoutMs: SLOW_QUERY_TIMEOUT_MS }),
      );
    },
  };
}
