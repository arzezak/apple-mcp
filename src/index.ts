#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRemindersTools } from "./reminders.js";
import { registerNotesTools } from "./notes.js";
import { registerCalendarTools } from "./calendar.js";

const server = new McpServer({
  name: "apple-mcp",
  version: "1.0.0",
});

registerRemindersTools(server);
registerNotesTools(server);
registerCalendarTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
