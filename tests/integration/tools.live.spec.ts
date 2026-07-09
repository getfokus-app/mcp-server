import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { saveCredentials } from '../../src/auth/credentials.js';
import { createContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';

/**
 * Live integration test against a local backend (backend/docker-compose.yml stack).
 * Opt-in: FOKUS_E2E=1 npx vitest run tests/integration
 * Registers a throwaway user (like web/e2e/auth.setup.ts) and drives the real
 * MCP tools through an in-memory client↔server pair.
 */
const API_URL = process.env.FOKUS_E2E_API_URL ?? 'http://localhost:3000';

let tmpDir: string;
let client: Client;
let email: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any): any {
  expect(res.isError, `tool failed: ${res.content?.[0]?.text}`).toBeFalsy();
  const text: string = res.content[0].text;
  const jsonStart = text.search(/[[{]/);
  return JSON.parse(text.slice(jsonStart));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return client.callTool({ name, arguments: args });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fokus-mcp-e2e-'));
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.FOKUS_API_URL = API_URL;

  // Fixed local test account: registered on first run, signed in afterwards
  // (register is throttled to 5/10min, sign-in to 5/min).
  email = process.env.FOKUS_E2E_EMAIL ?? 'mcp-e2e@fokus-e2e.test';
  const password = process.env.FOKUS_E2E_PASSWORD ?? 'E2e-test-password-1!';
  const clientId = crypto.randomUUID();
  const authHeaders = { 'Content-Type': 'application/json', 'x-client-id': clientId };

  let res = await fetch(`${API_URL}/auth/sign-in`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        firstName: 'MCP',
        lastName: 'E2E',
        email,
        password,
        timezone: 'Europe/Berlin',
      }),
    });
  }
  if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);
  const tokens = (await res.json()) as {
    access: { token: string; expiresIn: number };
    refresh: { token: string; expiresIn: number };
    user: { _id: string };
  };

  const wsRes = await fetch(`${API_URL}/v1/workspaces`, {
    headers: { Authorization: `Bearer ${tokens.access.token}`, 'x-client-id': clientId },
  });
  const workspaces = ((await wsRes.json()) as { data: { _id: string; name: string }[] }).data;

  const now = Date.now();
  saveCredentials({
    clientId,
    defaultApiUrl: API_URL,
    profiles: {
      [API_URL]: {
        access: { token: tokens.access.token, expiresAt: now + tokens.access.expiresIn * 1000 },
        refresh: { token: tokens.refresh.token, expiresAt: now + tokens.refresh.expiresIn * 1000 },
        user: { id: tokens.user._id, email, timezone: 'Europe/Berlin' },
        workspaceId: workspaces[0]?._id,
        workspaceName: workspaces[0]?.name,
      },
    },
  });

  const ctx = createContext();
  const server = buildServer(ctx);
  client = new Client({ name: 'fokus-mcp-e2e', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}, 30_000);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.FOKUS_API_URL;
});

describe('fokus-mcp live tools', () => {
  it('runs the full task/note lifecycle against the local backend', async () => {
    // identity & meta
    const user = parseResult(await call('get_current_user'));
    expect(user.email).toBe(email);
    const nowInfo = parseResult(await call('get_current_datetime'));
    expect(nowInfo.timezone).toBe('Europe/Berlin');
    const workspaces = parseResult(await call('list_workspaces'));
    expect(workspaces.some((w: { active: boolean }) => w.active)).toBe(true);

    // bucket
    const bucket = parseResult(
      await call('create_bucket', { title: 'MCP E2E Bucket', color: '#1570EF' }),
    );
    expect(bucket.id).toBeTruthy();

    // task with markdown description
    const markdown = '# Steps\n\n- [ ] first step\n- [x] done step\n\nSee **bold** and `code`.';
    const task = parseResult(
      await call('create_task', {
        title: 'MCP E2E Task',
        description: markdown,
        priority: 'high',
        energyLevel: 'light',
        estimatedTime: 30,
        bucketId: bucket.id,
      }),
    );
    expect(task.priority).toBe('high');

    const fetched = parseResult(await call('get_task', { taskId: task.id }));
    expect(fetched.description).toContain('# Steps');
    expect(fetched.description).toContain('- [ ] first step');
    expect(fetched.description).toContain('- [x] done step');
    expect(fetched.description).toContain('**bold**');

    // list + filters
    const inBucket = parseResult(await call('list_tasks', { bucketId: bucket.id }));
    expect(inBucket.some((t: { id: string }) => t.id === task.id)).toBe(true);
    const highOnly = parseResult(await call('list_tasks', { priority: 'high' }));
    expect(highOnly.some((t: { id: string }) => t.id === task.id)).toBe(true);

    // complete → disappears from open list
    await call('complete_task', { taskId: task.id });
    const openAfter = parseResult(await call('list_tasks', { bucketId: bucket.id }));
    expect(openAfter.some((t: { id: string }) => t.id === task.id)).toBe(false);

    // note round-trip
    const note = parseResult(
      await call('create_note', {
        title: 'MCP E2E Note',
        content: '## Findings\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quoted',
        bucketId: bucket.id,
      }),
    );
    const noteFull = parseResult(await call('get_note', { noteId: note.id }));
    expect(noteFull.content).toContain('## Findings');
    expect(noteFull.content).toContain('| a | b |');
    expect(noteFull.content).toContain('> quoted');

    // append keeps existing content
    parseResult(
      await call('update_note', { noteId: note.id, appendContent: 'Appended **tail**.' }),
    );
    const appended = parseResult(await call('get_note', { noteId: note.id }));
    expect(appended.content).toContain('## Findings');
    expect(appended.content).toContain('Appended **tail**.');

    // event lifecycle
    const eventStart = new Date(Date.now() + 3600_000).toISOString();
    const eventEnd = new Date(Date.now() + 7200_000).toISOString();
    const event = parseResult(
      await call('create_event', { title: 'MCP E2E Event', start: eventStart, end: eventEnd }),
    );
    expect(event.id).toBeTruthy();

    // schedule shows the event
    const today = new Date(Date.now() - 86400_000).toISOString();
    const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString();
    const schedule = parseResult(
      await call('get_schedule', { startDate: today, endDate: tomorrow }),
    );
    const scheduleText = JSON.stringify(schedule);
    expect(scheduleText).toContain('MCP E2E Event');

    // search finds both
    const found = parseResult(await call('search', { query: 'MCP E2E' }));
    expect(JSON.stringify(found)).toContain('MCP E2E Note');

    // objective lifecycle
    const objective = parseResult(
      await call('create_objective', {
        title: 'MCP E2E Objective',
        period: 'weekly',
        start: today,
        end: tomorrow,
      }),
    );
    parseResult(await call('update_objective', { objectiveId: objective.id, isCompleted: true }));

    // cleanup
    for (const [tool, args] of [
      ['delete_task', { taskId: task.id }],
      ['delete_note', { noteId: note.id }],
      ['delete_event', { eventId: event.id }],
      ['delete_objective', { objectiveId: objective.id }],
      ['delete_bucket', { bucketId: bucket.id }],
    ] as const) {
      const res = await call(tool, args);
      expect(res.isError, `${tool} failed: ${JSON.stringify(res.content)}`).toBeFalsy();
    }
  }, 60_000);
});
