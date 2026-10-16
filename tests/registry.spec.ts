import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createContext } from '../src/context.js';
import { buildRegistry } from '../src/server.js';

describe('buildRegistry', () => {
  const registry = buildRegistry(createContext());

  it('collects every tool with a unique name and a description', () => {
    const names = registry.tools.map((t) => t.name);
    expect(names).toContain('search_fokus_guide');
    expect(names.length).toBe(45);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of registry.tools) {
      expect(tool.config.description, tool.name).toBeTruthy();
    }
  });

  it('looks up tools by name', () => {
    expect(registry.get('list_tasks')).toBeDefined();
    expect(registry.get('nope')).toBeUndefined();
  });

  it('exposes input schemas that validate CLI-style JSON args', () => {
    const shape = registry.get('set_active_workspace')?.config.inputSchema ?? {};
    expect(z.object(shape).safeParse({}).success).toBe(false);
    expect(z.object(shape).safeParse({ workspace: 'Personal' }).success).toBe(true);
  });
});
