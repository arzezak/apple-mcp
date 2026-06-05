# apple-mcp

MCP server for Apple Reminders, Notes, and Calendar via AppleScript.

Requires [Bun](https://bun.sh) and macOS.

## Tools (19 total)

**Reminders:** `reminders_list_lists`, `reminders_list`, `reminders_create`, `reminders_complete`, `reminders_delete`, `reminders_search`

**Notes:** `notes_list_folders`, `notes_list`, `notes_read`, `notes_create`, `notes_edit`, `notes_search`, `notes_move`, `notes_delete`

**Calendar:** `calendar_list_calendars`, `calendar_list_events`, `calendar_create_event`, `calendar_search_events`, `calendar_delete_event`

## Notes formatting

`notes_create` and `notes_edit` accept markdown in the body, which is auto-converted to formatted HTML for Apple Notes. Supported syntax: `#` headings, `- ` bullet lists, `1.` numbered lists, `**bold**`, `*italic*`, `> ` blockquotes, and `- [ ]`/`- [x]` checkboxes. Existing HTML is passed through unchanged.

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
