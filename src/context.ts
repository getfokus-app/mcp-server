import { FokusClient } from './api/http.js';
import { CredentialsFile, StoredUser, getProfile, loadCredentials } from './auth/credentials.js';
import { TokenManager } from './auth/token-manager.js';
import { StaticTokenProvider, TokenProvider } from './auth/token-provider.js';
import { DEFAULT_API_URL, normalizeApiUrl } from './config.js';
import { Session } from './session.js';

export interface AppContext {
  apiUrl: string;
  /** Present only for the CLI/stdio context; the hosted server holds no local credentials. */
  creds?: CredentialsFile;
  tokens: TokenProvider;
  session: Session;
  client: FokusClient;
}

/** The CLI/stdio context: a real TokenManager backed by the on-disk credentials file. */
export interface CliContext extends AppContext {
  creds: CredentialsFile;
  tokens: TokenManager;
}

export function resolveApiUrl(creds: CredentialsFile, flag?: string): string {
  return normalizeApiUrl(
    flag ?? process.env.FOKUS_API_URL ?? creds.defaultApiUrl ?? DEFAULT_API_URL,
  );
}

export function createContext(apiUrlFlag?: string): CliContext {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(creds, apiUrlFlag);
  const tokens = new TokenManager(apiUrl, creds);
  const session = new Session(getProfile(creds, apiUrl));
  const client = new FokusClient(tokens, session);
  return { apiUrl, creds, tokens, session, client };
}

export interface HostedContextOptions {
  apiUrl: string;
  /** The MCP client's bearer token, forwarded to the REST API as-is. */
  accessToken: string;
  /** x-client-id sent to the REST API — a fixed UUID for the hosted MCP module. */
  clientId: string;
  /** Seeded from the JWT + the user record so date tools don't fall back to the server TZ. */
  user?: StoredUser;
  workspaceId?: string;
  workspaceName?: string;
}

/**
 * Build a per-request context for the hosted MCP server. Unlike createContext() this
 * touches no filesystem: the caller's access token is forwarded via StaticTokenProvider,
 * and the active workspace is passed in (persisted per-user server-side) rather than read
 * from a local profile.
 */
export function createHostedContext(opts: HostedContextOptions): AppContext {
  const apiUrl = normalizeApiUrl(opts.apiUrl);
  const tokens = new StaticTokenProvider(apiUrl, opts.accessToken, opts.clientId);
  const session = new Session();
  session.user = opts.user;
  session.workspaceId = opts.workspaceId;
  session.workspaceName = opts.workspaceName;
  const client = new FokusClient(tokens, session);
  return { apiUrl, tokens, session, client };
}
