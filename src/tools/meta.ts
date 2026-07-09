import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AppContext } from '../context.js';
import { READ_ONLY, UPDATE, jsonResult, run, textResult } from './shared.js';

interface WorkspaceInfo {
  _id: string;
  name: string;
  slug?: string;
  role?: string;
  isPersonal?: boolean;
}

interface MeResponse {
  _id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  userSettings?: { timeZones?: string[] };
}

/** Current date/time in an IANA timezone, assembled from Intl parts. */
export function nowInTimezone(timeZone: string): {
  timezone: string;
  iso: string;
  weekday: string;
  readable: string;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetRaw = get('timeZoneName'); // "GMT+02:00" or "GMT"
  const offset = offsetRaw === 'GMT' ? 'Z' : offsetRaw.replace('GMT', '');
  // en-CA with hour12:false can render midnight as "24" — normalize to "00"
  const hour = get('hour') === '24' ? '00' : get('hour');
  const iso = `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}${offset}`;

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);
  const readable = new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);

  return { timezone: timeZone, iso, weekday, readable };
}

export function registerMetaTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'get_current_user',
    {
      title: 'Get current user',
      description:
        'Get the logged-in Fokus user profile: name, email, timezone, and settings. ' +
        'Use this to learn the user timezone before working with dates.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(async () => {
        const { data: me } = await ctx.client.request<{ data: MeResponse }>('/auth/me', {
          workspace: false,
        });
        const timezone = me.userSettings?.timeZones?.[0];
        if (timezone && ctx.session.user) ctx.session.user.timezone = timezone;
        return jsonResult(ctx.session.workspaceHeader(), {
          id: me._id,
          email: me.email,
          firstName: me.firstName,
          lastName: me.lastName,
          timezone: timezone ?? ctx.session.timezone,
        });
      }),
  );

  server.registerTool(
    'get_current_datetime',
    {
      title: 'Get current date/time',
      description:
        "Get the current date and time in the user's timezone. Call this before " +
        'interpreting relative dates like "today", "tomorrow", or "next week".',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(async () => jsonResult(undefined, nowInTimezone(ctx.session.timezone))),
  );

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description:
        "List the user's Fokus workspaces with their role in each. The active workspace " +
        'is marked; all other tools operate within the active workspace.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: WorkspaceInfo[] }>('/v1/workspaces', {
          workspace: false,
        });
        return jsonResult(
          undefined,
          data.map((ws) => ({
            id: ws._id,
            name: ws.name,
            role: ws.role,
            isPersonal: ws.isPersonal,
            active: ws._id === ctx.session.workspaceId,
          })),
        );
      }),
  );

  server.registerTool(
    'set_active_workspace',
    {
      title: 'Set active workspace',
      description:
        'Switch the active workspace for this session (by id or exact name). Affects all ' +
        'subsequent tool calls in this session; the persisted default is unchanged.',
      inputSchema: {
        workspace: z.string().describe('Workspace id, slug, or exact name'),
      },
      annotations: UPDATE,
    },
    async ({ workspace }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: WorkspaceInfo[] }>('/v1/workspaces', {
          workspace: false,
        });
        const lower = workspace.toLowerCase();
        const found = data.find(
          (ws) => ws._id === workspace || ws.name.toLowerCase() === lower || ws.slug === lower,
        );
        if (!found) {
          return textResult(
            `No workspace matching "${workspace}". Available: ${data.map((w) => w.name).join(', ')}`,
          );
        }
        ctx.session.workspaceId = found._id;
        ctx.session.workspaceName = found.name;
        return textResult(`Active workspace switched to "${found.name}" (${found._id}).`);
      }),
  );
}
