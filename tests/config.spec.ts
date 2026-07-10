import { describe, expect, it } from 'vitest';

import { isInsecureApiUrl, normalizeApiUrl } from '../src/config.js';

describe('normalizeApiUrl', () => {
  it('lowercases the host and strips the trailing slash', () => {
    expect(normalizeApiUrl('https://API.GetFokus.com/')).toBe('https://api.getfokus.com');
    expect(normalizeApiUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('rejects non-http(s) schemes', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.com', 'not a url']) {
      expect(() => normalizeApiUrl(url), url).toThrow();
    }
  });
});

describe('isInsecureApiUrl', () => {
  it('flags plaintext http for non-loopback hosts only', () => {
    expect(isInsecureApiUrl('http://api.getfokus.com')).toBe(true);
    expect(isInsecureApiUrl('http://localhost:3000')).toBe(false);
    expect(isInsecureApiUrl('http://127.0.0.1:3000')).toBe(false);
    expect(isInsecureApiUrl('https://api.getfokus.com')).toBe(false);
  });
});
