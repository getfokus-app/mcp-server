import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { VERSION } from './config.js';
import { AppContext, createContext } from './context.js';
import { registerBucketTools } from './tools/buckets.js';
import { registerEventTools } from './tools/events.js';
import { registerMetaTools } from './tools/meta.js';
import { registerMiscTools } from './tools/misc.js';
import { registerNoteTools } from './tools/notes.js';
import { registerObjectiveTools } from './tools/objectives.js';
import { registerPrompts } from './tools/prompts.js';
import { ToolRegistry } from './tools/registry.js';
import { registerScheduleTools } from './tools/schedule.js';
import { registerSchedulingTools } from './tools/scheduling.js';
import { registerSearchTools } from './tools/search.js';
import { registerTaskTools } from './tools/tasks.js';

export function buildRegistry(ctx: AppContext): ToolRegistry {
  const registry = new ToolRegistry();
  registerMetaTools(registry, ctx);
  registerTaskTools(registry, ctx);
  registerEventTools(registry, ctx);
  registerNoteTools(registry, ctx);
  registerBucketTools(registry, ctx);
  registerObjectiveTools(registry, ctx);
  registerMiscTools(registry, ctx);
  registerSearchTools(registry, ctx);
  registerScheduleTools(registry, ctx);
  registerSchedulingTools(registry, ctx);
  return registry;
}

export function buildServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: 'fokus', version: VERSION });
  for (const tool of buildRegistry(ctx).tools) {
    // ToolDef erases the per-tool zod shape generic; the registry collected
    // the exact (config, handler) pairs the SDK accepts.
    server.registerTool(tool.name, tool.config, tool.handler as never);
  }
  registerPrompts(server, ctx);
  return server;
}

export async function serve(): Promise<void> {
  const ctx = createContext();
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — status goes to stderr
  console.error(`fokus-mcp v${VERSION} connected (API: ${ctx.apiUrl})`);
  if (!ctx.tokens.profile) {
    console.error('Warning: not logged in — tools will fail until you run: fokus-mcp login');
  }
}
