import { z } from "zod";

export const recurrenceSchema = z.object({
  frequency: z
    .enum(["daily", "weekly", "monthly", "yearly"])
    .describe("Repeat frequency: daily, weekly, monthly, or yearly"),
  interval: z
    .number()
    .int()
    .positive()
    .describe(
      "Repeat every N frequency units, e.g. 4 with monthly means every 4 months",
    ),
  count: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional end after this many occurrences"),
  until: z
    .string()
    .optional()
    .describe(
      "Optional ISO end date/time. Omit both count and until to repeat indefinitely.",
    ),
});

export type Recurrence = z.infer<typeof recurrenceSchema>;

export function recurrenceUntilDate(until: string): Date {
  const date = new Date(until);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid recurrence until date: ${until}`);
  }
  return date;
}

// RRULE text, used by Calendar as the event's recurrence and by both apps
// to describe the rule in confirmations.
export function recurrenceRule(recurrence: Recurrence): string {
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    throw new Error("Recurrence interval must be a positive integer.");
  }
  if (
    recurrence.count !== undefined &&
    (!Number.isInteger(recurrence.count) || recurrence.count < 1)
  ) {
    throw new Error("Recurrence count must be a positive integer.");
  }
  if (recurrence.count !== undefined && recurrence.until !== undefined) {
    throw new Error("Recurrence can end with count or until, not both.");
  }

  const parts = [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`,
  ];
  if (recurrence.count !== undefined) {
    parts.push(`COUNT=${recurrence.count}`);
  }
  if (recurrence.until !== undefined) {
    const stamp = recurrenceUntilDate(recurrence.until)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    parts.push(`UNTIL=${stamp}`);
  }
  return parts.join(";");
}
