import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.2.0';
export const DEFAULT_API_URL = 'https://api.getfokus.com';

/**
 * Validate and canonicalize an API URL: require http(s), lowercase the host,
 * strip a trailing slash. Rejecting non-http(s) keeps a bad --api-url/env value
 * out of both `fetch` and the browser-open spawn; lowercasing the host means the
 * same server maps to one credential profile regardless of case.
 */
export function normalizeApiUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid API URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`API URL must use http or https, got: ${parsed.protocol}`);
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString().replace(/\/+$/, '');
}

/** True for non-loopback plaintext-http URLs, where bearer tokens would travel in the clear. */
export function isInsecureApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
    return parsed.protocol === 'http:' && !loopback;
  } catch {
    return false;
  }
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
