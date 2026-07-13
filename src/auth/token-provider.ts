import { normalizeApiUrl } from '../config.js';
import { AuthRequiredError } from './token-manager.js';

/**
 * The auth surface FokusClient needs to sign a request. The stdio CLI supplies a
 * TokenManager (refresh + rotation against the local credentials file); the hosted
 * MCP server supplies a StaticTokenProvider that forwards the caller's bearer token.
 */
export interface TokenProvider {
  readonly apiUrl: string;
  readonly clientId: string;
  getAccessToken(): Promise<string>;
  /** Called after the API rejects the current access token with a 401. */
  handleUnauthorized(): Promise<string>;
}

/**
 * Token source for the hosted MCP server: the MCP client's bearer token is forwarded
 * to the Fokus REST API as-is, so the hosted process holds no credentials of its own.
 * With no refresh token to fall back on, a 401 surfaces as an auth-required error for
 * the client to re-authenticate rather than being silently retried.
 */
export class StaticTokenProvider implements TokenProvider {
  readonly apiUrl: string;
  readonly clientId: string;
  readonly #accessToken: string;

  constructor(apiUrl: string, accessToken: string, clientId: string) {
    this.apiUrl = normalizeApiUrl(apiUrl);
    this.#accessToken = accessToken;
    this.clientId = clientId;
  }

  async getAccessToken(): Promise<string> {
    return this.#accessToken;
  }

  async handleUnauthorized(): Promise<string> {
    throw new AuthRequiredError(
      'The Fokus access token was rejected (expired or revoked). Re-authenticate the MCP connection.',
    );
  }
}
