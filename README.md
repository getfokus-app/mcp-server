# Fokus MCP Server

The official [Model Context Protocol](https://modelcontextprotocol.io) server for [Fokus](https://getfokus.com) — manage your tasks, calendar, notes, and objectives from Claude Desktop, Claude Code, Cursor, or any other MCP client.

- **44 tools** across tasks, events, notes, buckets, objectives, tags, reminders, calendars, unified search, day/week agenda, and the Fokus auto-scheduler
- **Markdown in, markdown out** — note and description content is converted to/from the Fokus editor format, so formatting (headings, task lists, tables, code blocks) renders properly in the app
- Workspace-aware, with tool annotations so clients can warn before destructive actions

## Quick start

**1. Log in once** (stores rotating tokens in `~/.config/fokus-mcp/credentials.json`, `0600`):

```bash
npx -y @fokus-app/mcp login
```

Signing in with email/password is the default. If your account uses Google/Microsoft/Apple sign-in, either set a password first (Forgot password → set one), or use the paste-the-code flow:

```bash
npx -y @fokus-app/mcp login --oauth google
```

Your browser opens; after signing in you land on a "Redirecting to Fokus..." page — copy the `code` value from the address bar and paste it into the terminal. Note: if the Fokus desktop app is installed it may consume the code automatically; close it first or use email/password.

**2. Add the server to your MCP client:**

Claude Code:

```bash
claude mcp add fokus -- npx -y @fokus-app/mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fokus": { "command": "npx", "args": ["-y", "@fokus-app/mcp"] }
  }
}
```

Cursor (`.cursor/mcp.json`): same shape as Claude Desktop.

**3. Try it:** _"What does my day look like?"_, _"Add a task to review the Q3 report by Friday, high priority"_, _"Auto-schedule my week."_

## CLI commands

| Command                                                                  | What it does                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `fokus-mcp`                                                              | Run the MCP server on stdio (what your MCP client launches)      |
| `fokus-mcp login [--oauth [provider]] [--code <code>] [--api-url <url>]` | Sign in and pick a default workspace                             |
| `fokus-mcp logout`                                                       | Revoke the session server-side and delete local credentials      |
| `fokus-mcp whoami`                                                       | Show the logged-in user, timezone, workspace, and session expiry |
| `fokus-mcp workspace [id\|name]`                                         | List workspaces or change the default                            |
| `fokus-mcp tools [--json]`                                               | List all tools (`--json` includes input schemas)                 |
| `fokus-mcp tool <name> ['<json-args>' \| -]`                             | Invoke a tool directly, without an MCP client (see below)        |

## Tools

| Domain                       | Tools                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Meta                         | `get_current_user`, `get_current_datetime`, `list_workspaces`, `set_active_workspace`                                  |
| Tasks                        | `list_tasks`, `get_task`, `create_task`, `bulk_create_tasks`, `update_task`, `complete_task`, `delete_task`            |
| Events                       | `list_events`, `get_event`, `create_event`, `update_event`, `delete_event`                                             |
| Notes                        | `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`                                                  |
| Buckets                      | `list_buckets`, `create_bucket`, `update_bucket`, `delete_bucket`                                                      |
| Objectives                   | `list_objectives`, `get_objective`, `create_objective`, `update_objective`, `rollover_objective`, `delete_objective`   |
| Tags / Reminders / Calendars | `list_tags`, `create_tag`, `list_reminders`, `create_reminder`, `update_reminder`, `delete_reminder`, `list_calendars` |
| Search & agenda              | `search`, `get_schedule`                                                                                               |
| Auto-scheduling              | `auto_schedule_tasks`, `get_scheduling_job`, `apply_scheduling_job`, `cancel_scheduling_job`                           |

Recurring tasks/events are created by passing `recurringPattern` (an RRULE set incl. `DTSTART`) to `create_task` / `create_event`.

Two prompts ship with the server: `daily_planning` and `weekly_review`.

## Direct tool invocation (scripts & agent skills)

Every tool can also be called from the shell — same auth, workspace handling, and markdown
conversion as over MCP. This is what the `fokus` skill for OpenClaw and Hermes Agent uses
(see the `agent-skills` repo), and it works for plain scripting too:

```bash
fokus-mcp tool get_current_datetime
fokus-mcp tool list_tasks '{"status":"open","limit":10}'
fokus-mcp tool create_task '{"title":"Review Q3 report","priority":"high","estimatedTime":60}'
echo '{"title":"Standup notes","content":"# Monday\n\n- shipped the beta"}' | fokus-mcp tool create_note -
```

The text result prints to stdout; errors go to stderr with a non-zero exit code. Invalid
arguments print the tool's expected parameters. Pass `-` to read JSON args from stdin
(handy for long markdown content). Note that `set_active_workspace` only lasts for a single
invocation here — use `fokus-mcp workspace <id|name>` to switch persistently.

## Configuration

| Variable        | Meaning                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOKUS_API_URL` | Override the API URL for this process (self-hosted or local dev, e.g. `http://localhost:3000`). Credentials are stored per API URL, so prod and dev logins coexist — log in once per URL with `fokus-mcp login --api-url <url>`. |

## Security notes

- Credentials live in `~/.config/fokus-mcp/credentials.json`, written owner-only (`0600`) inside a `0700` directory. On Windows the file lives at `%APPDATA%\fokus-mcp`, which is user-profile-scoped by its inherited ACL (POSIX mode bits don't apply there).
- Fokus refresh tokens rotate on every use and expire after **7 idle days** — if you don't use the server for a week, run `fokus-mcp login` again.
- `fokus-mcp logout` revokes the session server-side; you can also revoke all sessions by changing your password.
- Delete/overwrite tools are annotated `destructiveHint` so MCP clients can ask for confirmation.

## Development

```bash
npm install
npm run build          # tsup → dist/index.js
npm test               # unit tests (markdown conversion, query builder, token manager)
npm run types:check

# integration tests against the local backend stack (backend/docker-compose.yml):
FOKUS_E2E=1 npx vitest run tests/integration

# poke at it interactively:
npx @modelcontextprotocol/inspector node dist/index.js
```

## Roadmap (v1.1)

Tag update/delete, revert task schedule, productivity stats, AI insights, workspace member management, people & bookings, MCP resources (`fokus://note/{id}`).
