# apple-mcp

MCP server for Apple Reminders, Notes, and Calendar via AppleScript.

Requires [Bun](https://bun.sh) and macOS.

## Tools (18 total)

**Reminders:** `reminders_list_lists`, `reminders_list`, `reminders_create`, `reminders_complete`, `reminders_delete`, `reminders_search`

**Notes:** `notes_list_folders`, `notes_list`, `notes_read`, `notes_create`, `notes_search`, `notes_move`, `notes_delete`

**Calendar:** `calendar_list_calendars`, `calendar_list_events`, `calendar_create_event`, `calendar_search_events`, `calendar_delete_event`

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

For Claude Code, add to `.mcp.json` in your project root or `~/.claude/.mcp.json` globally:

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
