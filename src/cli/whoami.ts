import { AuthRequiredError } from '../auth/token-manager.js';
import { createContext } from '../context.js';

interface MeResponse {
  email?: string;
  firstName?: string;
  lastName?: string;
  userSettings?: { timeZones?: string[] };
}

export async function whoami(): Promise<void> {
  const ctx = createContext();
  const profile = ctx.tokens.profile;
  if (!profile) {
    console.log(`Not logged in to ${ctx.apiUrl}. Run: fokus-mcp login`);
    process.exitCode = 1;
    return;
  }

  try {
    const { data: me } = await ctx.client.request<{ data: MeResponse }>('/auth/me', {
      workspace: false,
    });
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
    console.log(`API:       ${ctx.apiUrl}`);
    console.log(`User:      ${me.email ?? profile.user.email}${name ? ` (${name})` : ''}`);
    console.log(`Timezone:  ${me.userSettings?.timeZones?.[0] ?? ctx.session.timezone}`);
    console.log(`Workspace: ${profile.workspaceName ?? profile.workspaceId ?? '(none)'}`);
    console.log(
      `Session:   refresh token valid until ${new Date(profile.refresh.expiresAt).toLocaleString()}`,
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      console.log(`Session expired for ${ctx.apiUrl}. Run: fokus-mcp login`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
