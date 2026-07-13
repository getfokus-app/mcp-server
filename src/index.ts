import { login } from './cli/login.js';
import { logout } from './cli/logout.js';
import { tokenCommand } from './cli/token.js';
import { listTools, toolCommand } from './cli/tool.js';
import { whoami } from './cli/whoami.js';
import { workspaceCommand } from './cli/workspace.js';
import { VERSION } from './config.js';
import { serve } from './server.js';

const HELP = `fokus-mcp v${VERSION} — MCP server for Fokus (https://getfokus.com)

Usage:
  fokus-mcp                 Run the MCP server on stdio (default)
  fokus-mcp login           Sign in with email/password
    --oauth [google|microsoft|apple]   Sign in via browser (paste-the-code flow)
    --code <code>                      Exchange a code obtained from the browser
    --api-url <url>                    Target a different API (e.g. self-hosted)
  fokus-mcp logout          Revoke the session and remove local credentials
  fokus-mcp whoami          Show the logged-in user and active workspace
  fokus-mcp workspace [id]  List workspaces, or set the default workspace
  fokus-mcp token [create|list|revoke <id>]
                            Manage tokens for the hosted (remote) MCP server
    --label <name>                     Label a created token (e.g. "Claude Code")
  fokus-mcp tools           List tools available for direct invocation
    --json                             Machine-readable listing with input schemas
  fokus-mcp tool <name> ['<json-args>']
                            Invoke a tool directly (pass '-' to read JSON args from stdin)
  fokus-mcp help            Show this help

Environment:
  FOKUS_API_URL             Override the API URL for this process
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'login':
      await login(rest);
      break;
    case 'logout':
      await logout();
      break;
    case 'whoami':
      await whoami();
      break;
    case 'workspace':
      await workspaceCommand(rest);
      break;
    case 'token':
      await tokenCommand(rest);
      break;
    case 'tools':
      await listTools(rest);
      break;
    case 'tool':
      await toolCommand(rest);
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    case undefined:
      await serve();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(HELP);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
