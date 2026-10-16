import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { configDir, credentialsPath } from '../src/config.js';

describe('test sandbox', () => {
  it('keeps the credentials path inside the temp sandbox, never the real home', () => {
    expect(path.relative(os.tmpdir(), credentialsPath()).startsWith('..')).toBe(false);
    expect(path.relative(os.tmpdir(), configDir()).startsWith('..')).toBe(false);
  });

  it('keeps the homedir fallback inside the sandbox too', () => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.APPDATA;
    expect(path.relative(os.tmpdir(), configDir()).startsWith('..')).toBe(false);
  });
});
