import fs from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { VERSION } from '../src/config.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('version', () => {
  it('equals package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('is what the MCP handshake reports', async () => {
    const server = buildServer(createContext());
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getServerVersion()?.version).toBe(pkg.version);
    await client.close();
  });
});
