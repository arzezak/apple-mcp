import { execFile } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { esc } from "./osascript.ts";

const describeIntegration =
  process.env.APPLE_MCP_INTEGRATION === "1" ? describe : describe.skip;

const TEST_CONTAINER_NAME = "Test";

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function successCleanupScript(...names: string[]): string {
  return names.map((name) => `delete ${name}`).join("\n    ");
}

function errorCleanupScript(...names: string[]): string {
  return names
    .map((name) => `if ${name} is not missing value then delete ${name}`)
    .join("\n    ");
}

function expectDifferentIds(first: string, second: string): void {
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first).not.toBe(second);
}

function runIntegrationAppleScript(script: string): Promise<string> {
  const args: string[] = [];
  for (const line of script.split("\n")) {
    args.push("-e", line);
  }

  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      args,
      { timeout: 110_000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          reject(new Error(`AppleScript error: ${msg}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function assertCanRunAppleScript(script: string): Promise<void> {
  try {
    await runIntegrationAppleScript(script);
  } catch (error) {
    throw new Error(
      `Apple app integration test cannot run because osascript is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

describeIntegration("Apple app identity integration", () => {
  test("Reminders exposes IDs and can disambiguate duplicate titles by body", async () => {
    await assertCanRunAppleScript(
      'tell application "Reminders" to name of every list',
    );

    const title = uniqueName("shared-reminder-title");
    const firstBody = uniqueName("body-a");
    const secondBody = uniqueName("body-b");

    const raw = await runIntegrationAppleScript(`
tell application "Reminders"
  set createdA to missing value
  set createdB to missing value
  try
    try
      set box to list "${esc(TEST_CONTAINER_NAME)}"
    on error
      set box to make new list with properties {name:"${esc(TEST_CONTAINER_NAME)}"}
    end try

    tell box
      set createdA to make new reminder with properties {name:"${esc(title)}", body:"${esc(firstBody)}"}
      set createdB to make new reminder with properties {name:"${esc(title)}", body:"${esc(secondBody)}"}
    end tell

    set boxId to id of box
    set valueA to id of createdA
    set valueB to id of createdB
    set lookupTitle to name of (first reminder of box whose id is valueB)
    set lookupId to missing value
    repeat with candidate in every reminder of box
      if name of candidate is "${esc(title)}" and body of candidate is "${esc(secondBody)}" then
        set lookupId to id of candidate
      end if
    end repeat

    ${successCleanupScript("createdA", "createdB")}
    return boxId & linefeed & valueA & linefeed & valueB & linefeed & lookupTitle & linefeed & lookupId
  on error errMsg number errNum
    ${errorCleanupScript("createdA", "createdB")}
    error errMsg number errNum
  end try
end tell`);

    const [listId, firstId, secondId, foundByIdTitle, foundByTitleAndBodyId] =
      raw.split("\n");
    expect(listId).toBeTruthy();
    expectDifferentIds(firstId, secondId);
    expect(foundByIdTitle).toBe(title);
    expect(foundByTitleAndBodyId).toBe(secondId);
  }, 120_000);

  test("Notes exposes IDs and can disambiguate duplicate titles by plaintext body", async () => {
    await assertCanRunAppleScript(
      'tell application "Notes" to name of every folder',
    );

    const title = uniqueName("shared-note-title");
    const firstMarker = uniqueName("note-body-a");
    const secondMarker = uniqueName("note-body-b");
    const firstBody = `<h1>${title}</h1><p>${firstMarker}</p>`;
    const secondBody = `<h1>${title}</h1><p>${secondMarker}</p>`;

    const raw = await runIntegrationAppleScript(`
tell application "Notes"
  set createdA to missing value
  set createdB to missing value
  try
    set box to missing value
    repeat with candidate in every folder
      if name of candidate is "${esc(TEST_CONTAINER_NAME)}" then
        set box to candidate
      end if
    end repeat
    if box is missing value then
      tell default account
        set box to make new folder with properties {name:"${esc(TEST_CONTAINER_NAME)}"}
      end tell
    end if

    tell box
      set createdA to make new note with properties {name:"${esc(title)}", body:"${esc(firstBody)}"}
      set createdB to make new note with properties {name:"${esc(title)}", body:"${esc(secondBody)}"}
    end tell

    set valueA to id of createdA
    set valueB to id of createdB
    set lookupTitle to name of (first note whose id is valueB)
    set lookupId to missing value
    repeat with candidate in every note of box
      if name of candidate is "${esc(title)}" and plaintext of candidate contains "${esc(secondMarker)}" then
        set lookupId to id of candidate
      end if
    end repeat

    ${successCleanupScript("createdA", "createdB")}
    return valueA & linefeed & valueB & linefeed & lookupTitle & linefeed & lookupId
  on error errMsg number errNum
    ${errorCleanupScript("createdA", "createdB")}
    error errMsg number errNum
  end try
end tell`);

    const [firstId, secondId, foundByIdTitle, foundByTitleAndBodyId] =
      raw.split("\n");
    expectDifferentIds(firstId, secondId);
    expect(foundByIdTitle).toBe(title);
    expect(foundByTitleAndBodyId).toBe(secondId);
  }, 120_000);

  test("Calendar exposes IDs and can disambiguate duplicate titles by description", async () => {
    await assertCanRunAppleScript(
      'tell application "Calendar" to name of every calendar',
    );

    const title = uniqueName("shared-event-title");
    const firstDescription = uniqueName("event-body-a");
    const secondDescription = uniqueName("event-body-b");

    const raw = await runIntegrationAppleScript(`
set startsAtValue to current date
set startsAtValue to startsAtValue + (1 * days)
set seconds of startsAtValue to 0
set endsAtValue to startsAtValue + (30 * 60)

tell application "Calendar"
  set createdA to missing value
  set createdB to missing value
  try
    if "${esc(TEST_CONTAINER_NAME)}" is not in (name of every calendar) then
      set box to make new calendar with properties {name:"${esc(TEST_CONTAINER_NAME)}"}
    else
      set box to calendar "${esc(TEST_CONTAINER_NAME)}"
    end if

    tell box
      set createdA to make new event with properties {summary:"${esc(title)}", description:"${esc(firstDescription)}", start date:startsAtValue, end date:endsAtValue}
      set createdB to make new event with properties {summary:"${esc(title)}", description:"${esc(secondDescription)}", start date:startsAtValue, end date:endsAtValue}
    end tell

    set valueA to uid of createdA
    set valueB to uid of createdB
    set lookupTitle to summary of (first event of box whose uid is valueB)
    set lookupId to missing value
    repeat with candidate in every event of box
      if summary of candidate is "${esc(title)}" and description of candidate is "${esc(secondDescription)}" then
        set lookupId to uid of candidate
      end if
    end repeat

    ${successCleanupScript("createdA", "createdB")}
    return valueA & linefeed & valueB & linefeed & lookupTitle & linefeed & lookupId
  on error errMsg number errNum
    ${errorCleanupScript("createdA", "createdB")}
    error errMsg number errNum
  end try
end tell`);

    const [firstId, secondId, foundByIdTitle, foundByTitleAndBodyId] =
      raw.split("\n");
    expectDifferentIds(firstId, secondId);
    expect(foundByIdTitle).toBe(title);
    expect(foundByTitleAndBodyId).toBe(secondId);
  }, 120_000);
});
