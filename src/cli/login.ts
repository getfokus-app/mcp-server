import { spawn } from 'node:child_process';

import { Profile, loadCredentials, persistProfile } from '../auth/credentials.js';
import { DEFAULT_API_URL, normalizeApiUrl } from '../config.js';
import { ask, askHidden } from './prompts.js';

interface TokenPair {
  access: { token: string; expiresIn: number };
  refresh: { token: string; expiresIn: number };
  user: {
    _id?: string;
    id?: string;
    email: string;
    firstName?: string;
    lastName?: string;
    userSettings?: { timeZones?: string[] };
  };
}

interface WorkspaceInfo {
  _id: string;
  name: string;
  slug?: string;
  role?: string;
  isPersonal?: boolean;
}

interface LoginFlags {
  apiUrl?: string;
  oauth?: string;
  code?: string;
}

const OAUTH_PROVIDERS = ['google', 'microsoft', 'apple'];

function parseFlags(args: string[]): LoginFlags {
  const flags: LoginFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--api-url') flags.apiUrl = args[++i];
    else if (arg === '--code') flags.code = args[++i];
    else if (arg === '--oauth') {
      const next = args[i + 1];
      flags.oauth = next && OAUTH_PROVIDERS.includes(next) ? args[++i] : 'google';
    }
  }
  return flags;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // best effort — the URL is printed either way
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join('; ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    // fall through
  }
  return `HTTP ${res.status} ${res.statusText}`;
}

async function passwordLogin(apiUrl: string, clientId: string): Promise<TokenPair> {
  const email = await ask('Email: ');
  const password = await askHidden('Password: ');
  const res = await fetch(`${apiUrl}/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 429) {
    throw new Error('Too many sign-in attempts — wait a minute and try again.');
  }
  if (!res.ok) {
    throw new Error(`Sign-in failed: ${await readErrorMessage(res)}`);
  }
  return (await res.json()) as TokenPair;
}

async function oauthLogin(apiUrl: string, clientId: string, flags: LoginFlags): Promise<TokenPair> {
  let code = flags.code;
  if (!code) {
    const provider = flags.oauth ?? 'google';
    const url = `${apiUrl}/auth/${provider}?platform=desktop`;
    console.log(`\nOpening your browser to sign in with ${provider}:\n  ${url}\n`);
    console.log('After signing in you will land on a "Redirecting to Fokus..." page.');
    console.log('Copy the value of the "code" parameter from that page’s address bar.');
    console.log(
      'Note: if the Fokus desktop app is installed it may consume the code automatically —\n' +
        'close it first, or use email/password login instead.\n',
    );
    openBrowser(url);
    code = await ask('Paste code: ');
  }
  if (!code) throw new Error('No code provided.');

  const res = await fetch(`${apiUrl}/auth/exchange-code-stateless`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(
      `Code exchange failed: ${await readErrorMessage(res)} ` +
        '(codes are single-use and expire after 5 minutes)',
    );
  }
  return (await res.json()) as TokenPair;
}

async function pickWorkspace(
  apiUrl: string,
  clientId: string,
  accessToken: string,
): Promise<WorkspaceInfo | undefined> {
  const res = await fetch(`${apiUrl}/v1/workspaces`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'x-client-id': clientId },
  });
  if (!res.ok) return undefined;
  const workspaces = ((await res.json()) as { data?: WorkspaceInfo[] }).data ?? [];
  if (workspaces.length === 0) return undefined;
  if (workspaces.length === 1) return workspaces[0];

  console.log('\nYour workspaces:');
  workspaces.forEach((ws, i) => {
    console.log(`  ${i + 1}. ${ws.name}${ws.isPersonal ? ' (personal)' : ''}`);
  });
  const answer = await ask(`Default workspace [1-${workspaces.length}]: `);
  const index = Number.parseInt(answer, 10);
  if (Number.isInteger(index) && index >= 1 && index <= workspaces.length) {
    return workspaces[index - 1];
  }
  console.log(`Invalid choice — using "${workspaces[0]!.name}".`);
  return workspaces[0];
}

export async function login(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const creds = loadCredentials();
  const apiUrl = normalizeApiUrl(
    flags.apiUrl ?? process.env.FOKUS_API_URL ?? creds.defaultApiUrl ?? DEFAULT_API_URL,
  );
  console.log(`Signing in to ${apiUrl}`);

  const tokens =
    flags.oauth !== undefined || flags.code !== undefined
      ? await oauthLogin(apiUrl, creds.clientId, flags)
      : await passwordLogin(apiUrl, creds.clientId);

  const workspace = await pickWorkspace(apiUrl, creds.clientId, tokens.access.token);

  const now = Date.now();
  const profile: Profile = {
    access: { token: tokens.access.token, expiresAt: now + tokens.access.expiresIn * 1000 },
    refresh: { token: tokens.refresh.token, expiresAt: now + tokens.refresh.expiresIn * 1000 },
    user: {
      id: tokens.user._id ?? tokens.user.id ?? '',
      email: tokens.user.email,
      firstName: tokens.user.firstName,
      lastName: tokens.user.lastName,
      timezone: tokens.user.userSettings?.timeZones?.[0],
    },
    workspaceId: workspace?._id,
    workspaceName: workspace?.name,
  };
  persistProfile(apiUrl, profile, apiUrl);

  console.log(`\n✓ Logged in as ${tokens.user.email}`);
  if (workspace) console.log(`✓ Default workspace: ${workspace.name}`);
  console.log(
    '\nThe Fokus MCP server is ready. Add it to your MCP client, e.g.:\n' +
      '  claude mcp add fokus -- npx -y @fokus-app/mcp',
  );
}
