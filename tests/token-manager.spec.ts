import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CredentialsFile,
  Profile,
  loadCredentials,
  saveCredentials,
} from '../src/auth/credentials.js';
import { AuthRequiredError, TokenManager } from '../src/auth/token-manager.js';

const API = 'http://api.test';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    access: { token: 'access-1', expiresAt: Date.now() + 3600_000 },
    refresh: { token: 'refresh-1', expiresAt: Date.now() + 7 * 86400_000 },
    user: { id: 'u1', email: 'test@example.com' },
    ...overrides,
  };
}

function credsWith(p: Profile): CredentialsFile {
  return { clientId: 'client-1', profiles: { [API]: p } };
}

function refreshResponse(suffix: string) {
  return new Response(
    JSON.stringify({
      access: { token: `access-${suffix}`, expiresIn: 3600 },
      refresh: { token: `refresh-${suffix}`, expiresIn: 604800 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fokus-mcp-test-'));
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
});

describe('TokenManager', () => {
  it('returns the access token untouched while fresh', async () => {
    const manager = new TokenManager(API, credsWith(profile()));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(manager.getAccessToken()).resolves.toBe('access-1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws AuthRequiredError when no profile exists', async () => {
    const manager = new TokenManager(API, { clientId: 'c', profiles: {} });
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('refreshes proactively when the token is near expiry and persists rotation', async () => {
    const stale = profile({ access: { token: 'access-1', expiresAt: Date.now() + 10_000 } });
    saveCredentials(credsWith(stale));
    const manager = new TokenManager(API, credsWith(stale));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(refreshResponse('2'));

    await expect(manager.getAccessToken()).resolves.toBe('access-2');
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API}/auth/refresh-token`,
      expect.objectContaining({ method: 'POST' }),
    );
    const onDisk = loadCredentials();
    expect(onDisk.profiles[API]?.access.token).toBe('access-2');
    expect(onDisk.profiles[API]?.refresh.token).toBe('refresh-2');
  });

  it('deduplicates concurrent refreshes', async () => {
    const stale = profile({ access: { token: 'access-1', expiresAt: Date.now() } });
    saveCredentials(credsWith(stale));
    const manager = new TokenManager(API, credsWith(stale));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshResponse('2'));

    const [a, b, c] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);
    expect([a, b, c]).toEqual(['access-2', 'access-2', 'access-2']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('adopts fresher tokens written to disk by a sibling process instead of refreshing', async () => {
    const stale = profile({ access: { token: 'access-1', expiresAt: Date.now() } });
    const manager = new TokenManager(API, credsWith(stale));
    // sibling already rotated on disk
    saveCredentials(
      credsWith(profile({ access: { token: 'access-sibling', expiresAt: Date.now() + 3600_000 } })),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(manager.getAccessToken()).resolves.toBe('access-sibling');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('heals a rejected refresh by re-reading disk state rotated mid-flight', async () => {
    const stale = profile({
      access: { token: 'access-1', expiresAt: Date.now() },
      refresh: { token: 'refresh-1', expiresAt: Date.now() + 86400_000 },
    });
    saveCredentials(credsWith(stale));
    const manager = new TokenManager(API, credsWith(stale));

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      // sibling rotates while our refresh is in flight, invalidating refresh-1
      saveCredentials(
        credsWith(
          profile({ access: { token: 'access-sibling', expiresAt: Date.now() + 3600_000 } }),
        ),
      );
      return new Response('{"message":"Unauthorized"}', { status: 401 });
    });

    await expect(manager.getAccessToken()).resolves.toBe('access-sibling');
  });

  it('declares the session dead when refresh fails and disk has nothing newer', async () => {
    const stale = profile({ access: { token: 'access-1', expiresAt: Date.now() } });
    saveCredentials(credsWith(stale));
    const manager = new TokenManager(API, credsWith(stale));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"Unauthorized"}', { status: 401 }),
    );

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
