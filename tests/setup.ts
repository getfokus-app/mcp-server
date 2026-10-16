import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

// Point every config/home lookup at a throwaway directory so no spec can read or
// write the real ~/.config/fokus-mcp. HOME/USERPROFILE cover the homedir() fallback
// even when a spec unsets XDG_CONFIG_HOME.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fokus-mcp-sandbox-'));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.XDG_CONFIG_HOME = path.join(sandbox, 'xdg');
process.env.APPDATA = path.join(sandbox, 'appdata');

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});
