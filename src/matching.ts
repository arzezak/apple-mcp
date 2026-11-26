import { quoted } from "./osascript.ts";

function requireExactlyOne(
  { name, id }: { name?: string; id?: string },
  nameField: string,
): void {
  if ((name === undefined) === (id === undefined)) {
    throw new Error(`Provide exactly one of ${nameField} or id.`);
  }
}

export function whoseClause({
  nameProperty,
  name,
  id,
}: {
  nameProperty: string;
  name?: string;
  id?: string;
}): string {
  requireExactlyOne({ name, id }, "name");

  return id !== undefined
    ? `id is ${quoted(id)}`
    : `${nameProperty} is ${quoted(name!)}`;
}

export function matchLabel({ name, id }: { name?: string; id?: string }): string {
  return id !== undefined ? `with id ${id}` : quoted(name!);
}

// Checked with a count rather than by binding the match first: binding a
// reference to a reminder created seconds earlier blocks ~6-13s (2026-11-04).
export function requireMatching(kind: string, clause: string): string {
  return `if (count of (every ${kind} whose ${clause})) is 0 then error "No matching ${kind}." number 1`;
}

export function deleteFirstMatching(kind: string, clause: string): string {
  return `${requireMatching(kind, clause)}
  delete (first ${kind} whose ${clause})`;
}

// `event id` resolves in ~0.3s where `first event whose uid is` scans the
// whole calendar (~29s measured 2026-11-05).
export function eventSpecifier({ title, id }: { title?: string; id?: string }): string {
  requireExactlyOne({ name: title, id }, "title");

  return id !== undefined
    ? `event id ${quoted(id)}`
    : `first event whose summary is ${quoted(title!)}`;
}

export function requireEvent(specifier: string): string {
  return `if not (exists ${specifier}) then error "No matching event." number 1`;
}
