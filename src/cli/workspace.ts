import { getProfile, loadCredentials, saveCredentials } from '../auth/credentials.js';
import { createContext } from '../context.js';

interface WorkspaceInfo {
  _id: string;
  name: string;
  slug?: string;
  role?: string;
  isPersonal?: boolean;
}

export async function workspaceCommand(args: string[]): Promise<void> {
  const ctx = createContext();
  if (!ctx.tokens.profile) {
    console.log(`Not logged in to ${ctx.apiUrl}. Run: fokus-mcp login`);
    process.exitCode = 1;
    return;
  }

  const { data: workspaces } = await ctx.client.request<{ data: WorkspaceInfo[] }>(
    '/v1/workspaces',
    { workspace: false },
  );

  const target = args[0];
  if (!target) {
    console.log('Workspaces:');
    for (const ws of workspaces) {
      const active = ws._id === ctx.session.workspaceId ? ' *' : '';
      console.log(`  ${ws._id}  ${ws.name}${ws.isPersonal ? ' (personal)' : ''}${active}`);
    }
    console.log('\nSwitch with: fokus-mcp workspace <id|name>');
    return;
  }

  const lower = target.toLowerCase();
  const found = workspaces.find(
    (ws) => ws._id === target || ws.name.toLowerCase() === lower || ws.slug === lower,
  );
  if (!found) {
    console.log(`No workspace matching "${target}".`);
    process.exitCode = 1;
    return;
  }

  const disk = loadCredentials();
  const profile = getProfile(disk, ctx.apiUrl);
  if (!profile) {
    console.log('Credentials changed on disk — run: fokus-mcp login');
    process.exitCode = 1;
    return;
  }
  profile.workspaceId = found._id;
  profile.workspaceName = found.name;
  saveCredentials(disk);
  console.log(`✓ Default workspace set to ${found.name}`);
}
