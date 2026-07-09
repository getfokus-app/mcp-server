import { FokusClient } from './api/http.js';
import { CredentialsFile, getProfile, loadCredentials } from './auth/credentials.js';
import { TokenManager } from './auth/token-manager.js';
import { DEFAULT_API_URL, normalizeApiUrl } from './config.js';
import { Session } from './session.js';

export interface AppContext {
  apiUrl: string;
  creds: CredentialsFile;
  tokens: TokenManager;
  session: Session;
  client: FokusClient;
}

export function resolveApiUrl(creds: CredentialsFile, flag?: string): string {
  return normalizeApiUrl(
    flag ?? process.env.FOKUS_API_URL ?? creds.defaultApiUrl ?? DEFAULT_API_URL,
  );
}

export function createContext(apiUrlFlag?: string): AppContext {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(creds, apiUrlFlag);
  const tokens = new TokenManager(apiUrl, creds);
  const session = new Session(getProfile(creds, apiUrl));
  const client = new FokusClient(tokens, session);
  return { apiUrl, creds, tokens, session, client };
}
