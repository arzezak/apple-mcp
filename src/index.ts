#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRemindersTools } from "./reminders.ts";
import { registerNotesTools } from "./notes.ts";
import { registerCalendarTools } from "./calendar.ts";
import pkg from "../package.json" with { type: "json" };

const server = new McpServer({
  name: "apple-mcp",
  version: pkg.version,
});

registerRemindersTools(server);
registerNotesTools(server);
registerCalendarTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
