import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { configDir, credentialsPath, normalizeApiUrl } from '../config.js';

export interface StoredToken {
  token: string;
  /** Absolute expiry, unix ms. */
  expiresAt: number;
}

export interface StoredUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  timezone?: string;
}

export interface Profile {
  access: StoredToken;
  refresh: StoredToken;
  user: StoredUser;
  workspaceId?: string;
  workspaceName?: string;
}

export interface CredentialsFile {
  /** Stable per-installation id sent as x-client-id; the backend scopes token rotation to it. */
  clientId: string;
  /** API URL of the most recent login; used when FOKUS_API_URL is not set. */
  defaultApiUrl?: string;
  /** Keyed by normalized API URL so prod and local dev logins coexist. */
  profiles: Record<string, Profile>;
}

export function loadCredentials(): CredentialsFile {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw) as CredentialsFile;
    if (typeof parsed.clientId === 'string' && typeof parsed.profiles === 'object') {
      return parsed;
    }
  } catch {
    // missing or corrupt file — start fresh
  }
  return { clientId: randomUUID(), profiles: {} };
}

/** Atomic write (tmp + rename) so concurrent MCP processes never read a torn file. */
export function saveCredentials(creds: CredentialsFile): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = credentialsPath();
  const tmp = path.join(dir, `.credentials.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function getProfile(creds: CredentialsFile, apiUrl: string): Profile | undefined {
  return creds.profiles[normalizeApiUrl(apiUrl)];
}

export function setProfile(creds: CredentialsFile, apiUrl: string, profile: Profile): void {
  creds.profiles[normalizeApiUrl(apiUrl)] = profile;
}

export function deleteProfile(creds: CredentialsFile, apiUrl: string): void {
  delete creds.profiles[normalizeApiUrl(apiUrl)];
}

/**
 * Merge a profile change into the on-disk file instead of overwriting it wholesale,
 * so a concurrent process that rotated another profile is not clobbered.
 */
export function persistProfile(apiUrl: string, profile: Profile, defaultApiUrl?: string): void {
  const disk = loadCredentials();
  setProfile(disk, apiUrl, profile);
  if (defaultApiUrl) disk.defaultApiUrl = normalizeApiUrl(defaultApiUrl);
  saveCredentials(disk);
}
