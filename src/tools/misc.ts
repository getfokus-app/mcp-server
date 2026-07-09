import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, compact, containsRegex } from '../api/query.js';
import { AppContext } from '../context.js';
import {
  DATE_HINT,
  DESTRUCTIVE,
  Doc,
  READ_ONLY,
  UPDATE,
  WRITE,
  jsonResult,
  paginationHeader,
  refId,
  run,
  textResult,
} from './shared.js';

/** Tags, reminders, and calendars — small read/write surfaces grouped together. */
export function registerMiscTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'List tags in the active workspace (usable on tasks, events, and notes).',
      inputSchema: {
        nameContains: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 100'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/tags', {
          query: buildListQuery({
            filter: compact({
              name: input.nameContains ? containsRegex(input.nameContains) : undefined,
            }),
            sort: 'name',
            limit: input.limit ?? 100,
          }),
        });
        return jsonResult(
          paginationHeader(ctx, 'tags', res),
          res.data.map((t) => compact({ id: t._id, name: t.name, color: t.color })),
        );
      }),
  );

  server.registerTool(
    'create_tag',
    {
      title: 'Create tag',
      description: 'Create a tag in the active workspace.',
      inputSchema: {
        name: z.string(),
        color: z.string().optional().describe('Hex color'),
      },
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/tags', {
          method: 'POST',
          body: compact({ name: input.name, color: input.color }),
        });
        return jsonResult('Tag created', { id: data._id, name: data.name, color: data.color });
      }),
  );

  server.registerTool(
    'list_calendars',
    {
      title: 'List calendars',
      description:
        "List the user's calendars (Fokus-native and synced from Google/Outlook...). " +
        'Use ids when creating events or filtering tasks.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(async () => {
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/calendars', {
          query: buildListQuery({ limit: 100 }),
        });
        return jsonResult(
          paginationHeader(ctx, 'calendars', res),
          res.data.map((c) =>
            compact({
              id: c._id,
              title: c.title,
              primary: c.primary === true ? true : undefined,
              enabled: c.enabled,
              timeZone: c.timeZone,
              synced: c.source ? true : undefined,
            }),
          ),
        );
      }),
  );

  server.registerTool(
    'list_reminders',
    {
      title: 'List reminders',
      description: 'List reminders, by default only upcoming ones, soonest first.',
      inputSchema: {
        activityId: z.string().optional().describe('Reminders for one task/event'),
        upcomingOnly: z.boolean().optional().describe('Default true'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 25'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        const filter: Doc = compact({ activity: input.activityId });
        if (input.upcomingOnly !== false) filter.date = { $gte: new Date().toISOString() };
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/reminders', {
          query: buildListQuery({ filter, sort: 'date', limit: input.limit ?? 25 }),
        });
        return jsonResult(
          paginationHeader(ctx, 'reminders', res),
          res.data.map((r) =>
            compact({
              id: r._id,
              date: r.date,
              activity: refId(r.activity),
              relativeTo: r.relativeTo,
              offsetMinutes: r.offsetMinutes,
              type: r.type,
            }),
          ),
        );
      }),
  );

  server.registerTool(
    'create_reminder',
    {
      title: 'Create reminder',
      description:
        'Create a reminder for a task or event at an absolute time. Optionally record what ' +
        'the time is relative to (e.g. 15 min before start) so it follows recurring activities.',
      inputSchema: {
        activityId: z.string().describe('Task or event id'),
        date: z.string().describe(`When the reminder fires. ${DATE_HINT}`),
        relativeTo: z
          .enum(['start', 'end', 'doDate', 'dueDate', 'scheduledStart'])
          .optional()
          .describe('Reference point this time was computed from'),
        offsetMinutes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Minutes before the reference point'),
      },
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/reminders', {
          method: 'POST',
          body: compact({
            activity: input.activityId,
            date: input.date,
            relativeTo: input.relativeTo,
            offsetMinutes: input.offsetMinutes,
          }),
        });
        return jsonResult('Reminder created', {
          id: data._id,
          date: data.date,
          activity: refId(data.activity),
        });
      }),
  );

  server.registerTool(
    'update_reminder',
    {
      title: 'Update reminder',
      description: 'Change when a reminder fires.',
      inputSchema: {
        reminderId: z.string(),
        date: z.string().optional().describe(DATE_HINT),
        relativeTo: z.enum(['start', 'end', 'doDate', 'dueDate', 'scheduledStart']).optional(),
        offsetMinutes: z.number().int().min(0).optional(),
      },
      annotations: UPDATE,
    },
    async ({ reminderId, ...input }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/reminders/${reminderId}`, {
          method: 'PUT',
          body: compact(input),
        });
        return jsonResult('Reminder updated', { id: data._id, date: data.date });
      }),
  );

  server.registerTool(
    'delete_reminder',
    {
      title: 'Delete reminder',
      description: 'Delete a reminder.',
      inputSchema: { reminderId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ reminderId }) =>
      run(async () => {
        await ctx.client.request(`/v1/reminders/${reminderId}`, { method: 'DELETE' });
        return textResult(`Reminder ${reminderId} deleted.`);
      }),
  );
}
