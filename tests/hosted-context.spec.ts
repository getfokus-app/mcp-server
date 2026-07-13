import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { buildServer, createHostedContext } from '../src/lib.js';

describe('createHostedContext', () => {
  it('builds a context from the passed-in token without touching the filesystem', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const ctx = createHostedContext({
      apiUrl: 'https://api.test',
      accessToken: 'caller-token',
      clientId: 'mcp-client',
      user: { id: 'u1', email: 'a@b.c', timezone: 'Europe/Berlin' },
      workspaceId: 'w1',
      workspaceName: 'Work',
    });
    expect(ctx.creds).toBeUndefined();
    expect(ctx.session.workspaceId).toBe('w1');
    expect(ctx.session.timezone).toBe('Europe/Berlin');
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it('serves all 44 tools over the MCP protocol', async () => {
    const ctx = createHostedContext({
      apiUrl: 'https://api.test',
      accessToken: 'tok',
      clientId: 'mcp-client',
    });
    const server = buildServer(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(44);

    await client.close();
    await server.close();
  });
});
