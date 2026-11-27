import { runAppleScript, quoted, type RunScript } from "./osascript.ts";
import { runNameList, singleLine } from "./lists.ts";
import {
  appleScriptDateStatements,
  formatDate,
  formatDateTime,
  hasTimeComponent,
} from "./dates.ts";
import { whoseClause, deleteFirstMatching, requireMatching } from "./matching.ts";
import {
  recurrenceRule,
  recurrenceUntilDate,
  type Recurrence,
} from "./recurrence.ts";
import {
  eventKitReminders,
  eventStoreStatements,
  type ReadReminders,
  type ReminderRecord,
} from "./eventkit.ts";
import type {
  CreateReminderInput,
  ListRemindersInput,
  ReminderChanges,
  ReminderMatch,
  SearchRemindersInput,
  UpdateReminderInput,
} from "./reminders.inputs.ts";

function reminderLine(reminder: ReminderRecord, withList: boolean): string {
  const prefix = withList ? `${reminder.list}: ` : "- ";
  const parts = [`${prefix}${singleLine(reminder.name)}`];
  const notes = singleLine(reminder.notes);

  if (reminder.due) {
    parts.push(`due: ${reminder.timed ? formatDateTime(reminder.due) : formatDate(reminder.due)}`);
  }

  if (reminder.priority !== 0) parts.push(`priority: ${reminder.priority}`);
  if (notes) parts.push(`notes: ${notes}`);
  if (reminder.completed) parts.push(`completed: ${formatDateTime(reminder.completed)}`);
  parts.push(`id: ${reminder.id}`);

  return parts.join(" | ");
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

export function createReminders(
  run: RunScript = runAppleScript,
  { readReminders = eventKitReminders(run) }: { readReminders?: ReadReminders } = {},
): Reminders {
  return {
    listLists: () => runNameList(run, "Reminders", "name of every list"),

    async list({ listName, includeCompleted = false }) {
      const reminders = await readReminders({ listName, includeCompleted });

      return reminders.map((reminder) => reminderLine(reminder, false));
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

    async search({ query, includeCompleted = false }) {
      const loweredQuery = query.toLowerCase();
      const reminders = await readReminders({ includeCompleted });

      return reminders
        .filter((reminder) => reminder.name.toLowerCase().includes(loweredQuery))
        .map((reminder) => reminderLine(reminder, true));
    },
  };
}
