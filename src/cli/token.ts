import { createContext } from '../context.js';

interface MintedToken {
  id: string;
  token: string;
  label?: string;
  expiresIn: string;
}

interface TokenSummary {
  id: string;
  label?: string;
  createdAt: string;
}

/**
 * Manage long-lived MCP bearer tokens for the hosted (remote) MCP server. These let a client
 * that speaks Streamable HTTP — e.g. `claude mcp add --transport http` — connect without the
 * local CLI. Requires being logged in (the mint call is authenticated with the CLI session).
 */
export async function tokenCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = createContext();
  if (!ctx.tokens.profile) {
    console.error(`Not logged in to ${ctx.apiUrl}. Run: fokus-mcp login`);
    process.exitCode = 1;
    return;
  }

  switch (sub ?? 'create') {
    case 'create': {
      const label = readLabel(rest);
      const { data } = await ctx.client.request<{ data: MintedToken }>('/mcp-tokens', {
        method: 'POST',
        body: label ? { label } : {},
        workspace: false,
      });
      const url = `${ctx.apiUrl}/mcp`;
      console.log(
        `Created MCP token${data.label ? ` "${data.label}"` : ''} (expires in ${data.expiresIn}).`,
      );
      console.log('\nAdd it to Claude Code:\n');
      console.log(
        `  claude mcp add --transport http fokus ${url} --header "Authorization: Bearer ${data.token}"`,
      );
      console.log('\nStore this token now — it is not shown again.');
      break;
    }
    case 'list': {
      const { data } = await ctx.client.request<{ data: TokenSummary[] }>('/mcp-tokens', {
        workspace: false,
      });
      if (!data.length) {
        console.log('No MCP tokens. Create one with: fokus-mcp token create');
        break;
      }
      for (const t of data) {
        const when = new Date(t.createdAt).toLocaleString();
        console.log(`${t.id}  ${t.label ?? '(no label)'}  created ${when}`);
      }
      break;
    }
    case 'revoke': {
      const id = rest[0];
      if (!id) {
        console.error('Usage: fokus-mcp token revoke <id>');
        process.exitCode = 1;
        return;
      }
      await ctx.client.request(`/mcp-tokens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        workspace: false,
      });
      console.log(`Revoked MCP token ${id}.`);
      break;
    }
    default:
      console.error(`Unknown token command: ${sub}. Use: create | list | revoke <id>`);
      process.exitCode = 1;
  }
}

/** Read an optional label from `--label <value>` or the first positional argument. */
function readLabel(args: string[]): string | undefined {
  const flagIndex = args.indexOf('--label');
  if (flagIndex !== -1) return args[flagIndex + 1];
  return args[0];
}
