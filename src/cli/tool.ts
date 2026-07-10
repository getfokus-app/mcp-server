import { z, type ZodRawShape } from 'zod';

import { createContext } from '../context.js';
import { buildRegistry } from '../server.js';
import type { ToolDef } from '../tools/registry.js';

function describeParams(shape: ZodRawShape): string[] {
  const schema = z.toJSONSchema(z.object(shape)) as {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, prop]) => {
    const optional = required.has(key) ? '' : ' (optional)';
    const description = prop.description ? ` — ${prop.description}` : '';
    return `  ${key}${optional}${description}`;
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function listTools(args: string[]): Promise<void> {
  const registry = buildRegistry(createContext());
  if (args.includes('--json')) {
    const tools = registry.tools.map((t) => ({
      name: t.name,
      title: t.config.title,
      description: t.config.description,
      inputSchema: z.toJSONSchema(z.object(t.config.inputSchema ?? {})),
      annotations: t.config.annotations,
    }));
    console.log(JSON.stringify(tools, null, 2));
    return;
  }
  const width = Math.max(...registry.tools.map((t) => t.name.length));
  for (const t of registry.tools) {
    const summary = ((t.config.description ?? '').split('. ')[0] ?? '').replace(/\s+/g, ' ').trim();
    console.log(`  ${t.name.padEnd(width)}  ${summary}`);
  }
  console.log("\nInvoke with: fokus-mcp tool <name> ['<json-args>']");
}

export async function toolCommand(args: string[]): Promise<void> {
  const [name, rawArgs] = args;
  if (!name) {
    console.error("Usage: fokus-mcp tool <name> ['<json-args>' | -]");
    console.error('List available tools with: fokus-mcp tools');
    process.exitCode = 1;
    return;
  }

  const ctx = createContext();
  const def: ToolDef | undefined = buildRegistry(ctx).get(name);
  if (!def) {
    console.error(`Unknown tool "${name}". Run: fokus-mcp tools`);
    process.exitCode = 1;
    return;
  }

  let input: unknown = {};
  if (rawArgs !== undefined) {
    const json = rawArgs === '-' ? await readStdin() : rawArgs;
    try {
      input = JSON.parse(json);
    } catch (error) {
      console.error(`Invalid JSON args: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  }

  const shape = def.config.inputSchema ?? {};
  const parsed = z.object(shape).safeParse(input);
  if (!parsed.success) {
    console.error(z.prettifyError(parsed.error));
    const params = describeParams(shape);
    console.error(params.length ? `\nParameters for ${name}:\n${params.join('\n')}` : '');
    process.exitCode = 1;
    return;
  }

  const result = await def.handler(parsed.data);
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (result.isError) {
    console.error(text);
    process.exitCode = 1;
  } else {
    console.log(text);
  }
}
