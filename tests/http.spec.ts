import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FokusClient } from '../src/api/http.js';
import { StaticTokenProvider } from '../src/auth/token-provider.js';
import { Session } from '../src/session.js';

const WORKSPACES = [
  { _id: 'ws-team', name: 'Team' },
  { _id: 'ws-personal', name: 'Default', isPersonal: true },
];

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Minimal fetch stub: routes by URL, records every call. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((route) => url.includes(route));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(key ? routes[key] : {}),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  const at = (index: number): RecordedCall => {
    const call = calls.at(index);
    if (!call) throw new Error(`No fetch call at index ${index} (got ${calls.length})`);
    return call;
  };

  return { calls, fetchMock, at };
}

const build = (workspaceId?: string) => {
  const session = new Session();
  session.workspaceId = workspaceId;
  const tokens = new StaticTokenProvider('https://api.test', 'tok', 'client-1');
  return { client: new FokusClient(tokens, session), session };
};

const headerOf = (init: RequestInit) => (init.headers as Record<string, string>)['x-workspace-id'];

describe('FokusClient workspace handling', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends the workspace header and does not probe when the session has one', async () => {
    const { calls, at } = stubFetch({ '/v1/tasks': { data: {} } });
    const { client } = build('ws-existing');

    await client.request('/v1/tasks', { method: 'POST', body: { title: 'x' } });

    expect(calls).toHaveLength(1);
    expect(at(0).url).toContain('/v1/tasks');
    expect(headerOf(at(0).init)).toBe('ws-existing');
  });

  // Regression: a workspace-less session used to omit x-workspace-id entirely, so the API
  // stored the created record with no workspace and it was invisible in the Fokus apps.
  it('probes and prefers the personal workspace when the session has none', async () => {
    const { at } = stubFetch({ '/v1/workspaces': { data: WORKSPACES }, '/v1/tasks': {} });
    const { client, session } = build();

    await client.request('/v1/tasks', { method: 'POST', body: { title: 'x' } });

    expect(at(0).url).toContain('/v1/workspaces');
    expect(headerOf(at(0).init)).toBeUndefined();
    expect(at(1).url).toContain('/v1/tasks');
    expect(headerOf(at(1).init)).toBe('ws-personal');
    expect(session.workspaceId).toBe('ws-personal');
    expect(session.workspaceName).toBe('Default');
  });

  it('falls back to the first workspace when none is marked personal', async () => {
    stubFetch({ '/v1/workspaces': { data: [{ _id: 'ws-only', name: 'Only' }] }, '/v1/tasks': {} });
    const { client, session } = build();

    await client.request('/v1/tasks', { method: 'POST', body: {} });

    expect(session.workspaceId).toBe('ws-only');
  });

  it('probes only once for concurrent requests', async () => {
    const { calls } = stubFetch({ '/v1/workspaces': { data: WORKSPACES }, '/v1/tasks': {} });
    const { client } = build();

    await Promise.all([
      client.request('/v1/tasks', { method: 'POST', body: {} }),
      client.request('/v1/tasks', { method: 'POST', body: {} }),
    ]);

    expect(calls.filter((call) => call.url.includes('/v1/workspaces'))).toHaveLength(1);
  });

  it('fails a write loudly rather than orphaning it when no workspace exists', async () => {
    stubFetch({ '/v1/workspaces': { data: [] } });
    const { client } = build();

    await expect(client.request('/v1/tasks', { method: 'POST', body: {} })).rejects.toThrow(
      /No active workspace/,
    );
  });

  it('still allows reads when no workspace can be resolved', async () => {
    const { at } = stubFetch({ '/v1/workspaces': { data: [] }, '/v1/tasks': { data: [] } });
    const { client } = build();

    await expect(client.request('/v1/tasks')).resolves.toEqual({ data: [] });
    expect(headerOf(at(-1).init)).toBeUndefined();
  });

  it('does not probe for endpoints that opt out of the workspace header', async () => {
    const { calls, at } = stubFetch({ '/auth/me': { data: {} } });
    const { client } = build();

    await client.request('/auth/me', { workspace: false });

    expect(calls).toHaveLength(1);
    expect(at(0).url).toContain('/auth/me');
  });
});
