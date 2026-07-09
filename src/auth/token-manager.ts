import { normalizeApiUrl } from '../config.js';
import {
  CredentialsFile,
  Profile,
  getProfile,
  loadCredentials,
  persistProfile,
  setProfile,
} from './credentials.js';

export class AuthRequiredError extends Error {
  constructor(
    message = 'Not logged in or the session expired (refresh tokens die after 7 idle days). Run: npx -y @fokus-app/mcp login',
  ) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

interface RefreshResponse {
  access: { token: string; expiresIn: number };
  refresh: { token: string; expiresIn: number };
}

/** Refresh proactively when the access token has less than this long to live. */
const EXPIRY_MARGIN_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Manages the JWT access/refresh pair for one API URL profile.
 *
 * Multiple MCP host apps (Claude Desktop, Cursor, ...) each spawn their own fokus-mcp
 * process sharing one credentials file, and the backend revokes a client's previous
 * tokens on every refresh. So before refreshing we re-read the file (a sibling may have
 * rotated already), writes are atomic merges, and a rejected refresh gets one retry
 * against freshly re-read disk state before the session is declared dead.
 */
export class TokenManager {
  readonly apiUrl: string;
  #creds: CredentialsFile;
  #refreshing: Promise<string> | null = null;

  constructor(apiUrl: string, creds?: CredentialsFile) {
    this.apiUrl = normalizeApiUrl(apiUrl);
    this.#creds = creds ?? loadCredentials();
  }

  get clientId(): string {
    return this.#creds.clientId;
  }

  get profile(): Profile | undefined {
    return getProfile(this.#creds, this.apiUrl);
  }

  async getAccessToken(): Promise<string> {
    const profile = this.profile;
    if (!profile) throw new AuthRequiredError();
    if (profile.access.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return profile.access.token;
    return this.#refresh();
  }

  /** Called when the API rejected the current access token with a 401. */
  async handleUnauthorized(): Promise<string> {
    return this.#refresh();
  }

  #refresh(): Promise<string> {
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<string> {
    const fromDisk = this.#reloadFromDisk();
    if (fromDisk && fromDisk.access.expiresAt - Date.now() > EXPIRY_MARGIN_MS) {
      return fromDisk.access.token;
    }
    const profile = this.profile;
    if (!profile) throw new AuthRequiredError();

    const rotated = await this.#requestRefresh(profile.refresh.token);
    if (rotated) return rotated;

    // Rejected — a sibling process may have rotated this token mid-flight.
    await sleep(500);
    const retryProfile = this.#reloadFromDisk();
    if (retryProfile) {
      if (retryProfile.access.expiresAt - Date.now() > EXPIRY_MARGIN_MS) {
        return retryProfile.access.token;
      }
      if (retryProfile.refresh.token !== profile.refresh.token) {
        const retried = await this.#requestRefresh(retryProfile.refresh.token);
        if (retried) return retried;
      }
    }
    throw new AuthRequiredError();
  }

  /** Returns the new access token, or null when the refresh token was rejected. */
  async #requestRefresh(refreshToken: string): Promise<string | null> {
    const res = await fetch(`${this.apiUrl}/auth/refresh-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${refreshToken}`,
        'x-client-id': this.clientId,
      },
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Token refresh failed: HTTP ${res.status} ${res.statusText}`);

    const body = (await res.json()) as RefreshResponse;
    const profile = this.profile;
    if (!profile) throw new AuthRequiredError();

    const now = Date.now();
    const updated: Profile = {
      ...profile,
      access: { token: body.access.token, expiresAt: now + body.access.expiresIn * 1000 },
      refresh: { token: body.refresh.token, expiresAt: now + body.refresh.expiresIn * 1000 },
    };
    setProfile(this.#creds, this.apiUrl, updated);
    persistProfile(this.apiUrl, updated);
    return updated.access.token;
  }

  #reloadFromDisk(): Profile | undefined {
    this.#creds = loadCredentials();
    return this.profile;
  }
}
