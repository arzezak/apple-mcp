// Built from numbers, not from a `date "..."` literal: AppleScript parses a
// literal with the system locale, so "30 November 2026" is a syntax error
// under en_US and "30/11/2026" silently becomes June 2028 (2026-11-25).
// The day goes to 1 first so a 31st does not roll the month over.
export function appleScriptDateStatements(variable: string, input: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      input,
    );

  if (!match) {
    throw new Error(
      `Invalid date: ${input}. Use YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS].`,
    );
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const date = new Date(iso);

  if (Number.isNaN(date.getTime()) || date.toISOString() !== iso) {
    throw new Error(`Invalid ISO date: ${input}`);
  }

  const secondsIntoDay =
    Number(hour) * 3600 + Number(minute) * 60 + Number(second);

  return `set ${variable} to current date
set day of ${variable} to 1
set year of ${variable} to ${Number(year)}
set month of ${variable} to ${Number(month)}
set day of ${variable} to ${Number(day)}
set time of ${variable} to ${secondsIntoDay}`;
}

const TIME_COMPONENT_RE =
  /(?:[ T]\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b)/i;

export function hasTimeComponent(input: string): boolean {
  return TIME_COMPONENT_RE.test(input);
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "full",
  timeStyle: "medium",
});

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "full" });

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}
