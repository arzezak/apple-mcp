# apple-mcp

MCP server for Apple Reminders, Notes, and Calendar via AppleScript.

Requires [Bun](https://bun.sh) and macOS.

## Tools (21 total)

**Reminders:** `reminders_list_lists`, `reminders_list`, `reminders_create`, `reminders_update`, `reminders_complete`, `reminders_delete`, `reminders_search`

**Notes:** `notes_list_folders`, `notes_list`, `notes_read`, `notes_create`, `notes_edit`, `notes_search`, `notes_move`, `notes_delete`

**Calendar:** `calendar_list_calendars`, `calendar_list_events`, `calendar_create_event`, `calendar_update_event`, `calendar_search_events`, `calendar_delete_event`

`reminders_create` and `calendar_create_event` return the new item's id, and `reminders_list`, `reminders_search`, `calendar_list_events` and `calendar_search_events` end each line with it. `reminders_update`, `reminders_complete`, `reminders_delete`, `calendar_update_event` and `calendar_delete_event` accept that `id` in place of `name` or `title`.

`reminders_update` and `calendar_update_event` change an item in place; only the fields given are touched. For an event, `startDate` alone moves the day and keeps the time and duration, `hour`/`minute`/`durationMinutes` change the time, and `allDay` switches between all-day and timed. `reminders_search` prefixes each line with its list name; with `includeCompleted` it returns names only, because fetching full records for completed reminders across all lists exceeds the 60s query timeout.

`calendar_create_event` and `reminders_create` accept an optional `recurrence` object:

```json
{
  "frequency": "daily | weekly | monthly | yearly",
  "interval": 4,
  "count": 10,
  "until": "2027-01-15T12:30:00Z"
}
```

Omit both `count` and `until` to repeat indefinitely. For example, `{"frequency":"monthly","interval":4}` creates an event that repeats every 4 months with no end date.

Reminders have no recurrence in their AppleScript dictionary, so `reminders_create` attaches the rule through EventKit (JavaScript for Automation). The first use may prompt to allow `osascript` access to Reminders under System Settings > Privacy & Security.

It also accepts optional `startDate` for a specific ISO date. When `startDate` is omitted, the existing `daysFromNow` behavior is used.

## Notes formatting

`notes_create` and `notes_edit` accept markdown in the body, which is auto-converted to formatted HTML for Apple Notes. Supported syntax: `#` headings, `- ` bullet lists, `1.` numbered lists, `**bold**`, `*italic*`, fenced code blocks, and `` `inline code` ``. Existing HTML is passed through unchanged.

## How it works

This is a **stdio-based** MCP server. You don't start it yourself. The MCP client (Claude Desktop, Claude Code, etc.) spawns the process on demand and communicates over stdin/stdout. Just register it in your client config and the client handles the rest.

## Setup

```bash
cd apple-mcp
bun install
```

No build step. Bun runs TypeScript directly.

## Register with Claude

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bun",
      "args": ["run", "/FULL/PATH/TO/apple-mcp/src/index.ts"]
    }
  }
}
```

For Claude Code, either run:

```bash
claude mcp add --scope user apple-mcp -- bun run /FULL/PATH/TO/apple-mcp/src/index.ts
```

Or manually add to `.mcp.json` in your project root or `~/.claude/.mcp.json` globally:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bun",
      "args": ["run", "/FULL/PATH/TO/apple-mcp/src/index.ts"]
    }
  }
}
```

Replace `/FULL/PATH/TO/` with the actual path.

## Permissions

On first use, macOS will prompt you to allow automation access for Terminal (or whatever app runs the server) to control Reminders, Notes, and Calendar. Grant this in **System Settings > Privacy & Security > Automation**.
