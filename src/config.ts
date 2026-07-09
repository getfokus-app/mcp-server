import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.1.0';
export const DEFAULT_API_URL = 'https://api.getfokus.com';

/** Strip trailing slashes so profiles keyed by API URL match reliably. */
export function normalizeApiUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function configDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'fokus-mcp');
  }
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(base, 'fokus-mcp');
}

export function credentialsPath(): string {
  return path.join(configDir(), 'credentials.json');
}
