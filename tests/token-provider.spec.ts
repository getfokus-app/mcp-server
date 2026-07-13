import { describe, expect, it, vi } from 'vitest';

import { AuthRequiredError } from '../src/auth/token-manager.js';
import { StaticTokenProvider } from '../src/auth/token-provider.js';

const API = 'https://api.test';

describe('StaticTokenProvider', () => {
  it('forwards the supplied access token without any network call', async () => {
    const provider = new StaticTokenProvider(API, 'incoming-bearer', 'client-1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(provider.getAccessToken()).resolves.toBe('incoming-bearer');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exposes the normalized apiUrl and clientId', () => {
    const provider = new StaticTokenProvider('https://API.test/', 'tok', 'client-9');
    expect(provider.apiUrl).toBe('https://api.test');
    expect(provider.clientId).toBe('client-9');
  });

  it('throws AuthRequiredError on 401 instead of refreshing', async () => {
    const provider = new StaticTokenProvider(API, 'tok', 'client-1');
    await expect(provider.handleUnauthorized()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
