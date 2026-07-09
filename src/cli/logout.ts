import {
  deleteProfile,
  getProfile,
  loadCredentials,
  saveCredentials,
} from '../auth/credentials.js';
import { resolveApiUrl } from '../context.js';

export async function logout(): Promise<void> {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(creds);
  const profile = getProfile(creds, apiUrl);
  if (!profile) {
    console.log(`Not logged in to ${apiUrl}.`);
    return;
  }

  try {
    await fetch(`${apiUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.access.token}`,
        'x-client-id': creds.clientId,
      },
    });
  } catch {
    // revocation is best-effort; local credentials are removed regardless
  }

  const disk = loadCredentials();
  deleteProfile(disk, apiUrl);
  saveCredentials(disk);
  console.log(`✓ Logged out of ${apiUrl}.`);
}
