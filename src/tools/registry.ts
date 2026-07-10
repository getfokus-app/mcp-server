import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';

export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
}

export interface ToolDef {
  name: string;
  config: ToolConfig;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * Collects tool definitions so they can be served over MCP (replayed into an
 * McpServer in server.ts) or invoked directly by the `fokus-mcp tool` CLI.
 * registerTool is call-compatible with McpServer.registerTool so the tool
 * modules only need a parameter-type change.
 */
export class ToolRegistry {
  readonly tools: ToolDef[] = [];

  registerTool<Shape extends ZodRawShape>(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: Shape;
      annotations?: ToolAnnotations;
    },
    handler: (args: z.output<z.ZodObject<Shape>>) => Promise<CallToolResult>,
  ): void {
    this.tools.push({ name, config, handler: handler as ToolDef['handler'] });
  }

  get(name: string): ToolDef | undefined {
    return this.tools.find((t) => t.name === name);
  }
}
