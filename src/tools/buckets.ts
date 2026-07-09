import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, compact, containsRegex } from '../api/query.js';
import { AppContext } from '../context.js';
import {
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

function slimBucket(bucket: Doc): Doc {
  return compact({
    id: bucket._id,
    title: bucket.title,
    color: bucket.color,
    icon: bucket.icon,
    parent: refId(bucket.parent),
    defaultCalendar: refId(bucket.defaultCalendar),
  });
}

export function registerBucketTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'list_buckets',
    {
      title: 'List buckets',
      description:
        'List buckets (projects/categories that group tasks, events, and notes) in the ' +
        'active workspace. Buckets can be nested via `parent`.',
      inputSchema: {
        titleContains: z.string().optional().describe('Case-insensitive title search'),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 50)'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/buckets', {
          query: buildListQuery({
            filter: compact({
              title: input.titleContains ? containsRegex(input.titleContains) : undefined,
            }),
            sort: 'title',
            page: input.page,
            limit: input.limit ?? 50,
          }),
        });
        return jsonResult(paginationHeader(ctx, 'buckets', res), res.data.map(slimBucket));
      }),
  );

  server.registerTool(
    'create_bucket',
    {
      title: 'Create bucket',
      description: 'Create a bucket (project/category) in the active workspace.',
      inputSchema: {
        title: z.string(),
        color: z.string().optional().describe('Hex color (default #6366f1)'),
        parentId: z.string().optional().describe('Parent bucket id for nesting'),
        defaultCalendarId: z.string().optional(),
      },
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/buckets', {
          method: 'POST',
          body: compact({
            title: input.title,
            color: input.color ?? '#6366f1',
            parent: input.parentId,
            defaultCalendar: input.defaultCalendarId,
          }),
        });
        return jsonResult('Bucket created', slimBucket(data));
      }),
  );

  server.registerTool(
    'update_bucket',
    {
      title: 'Update bucket',
      description: 'Update a bucket title, color, or nesting.',
      inputSchema: {
        bucketId: z.string(),
        title: z.string().optional(),
        color: z.string().optional(),
        parentId: z.string().optional(),
        defaultCalendarId: z.string().optional(),
      },
      annotations: UPDATE,
    },
    async ({ bucketId, ...input }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/buckets/${bucketId}`, {
          method: 'PUT',
          body: compact({
            title: input.title,
            color: input.color,
            parent: input.parentId,
            defaultCalendar: input.defaultCalendarId,
          }),
        });
        return jsonResult('Bucket updated', slimBucket(data));
      }),
  );

  server.registerTool(
    'delete_bucket',
    {
      title: 'Delete bucket',
      description:
        'Permanently delete a bucket. Tasks/notes in it are NOT deleted but lose their ' +
        'bucket assignment. Cannot be undone.',
      inputSchema: { bucketId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ bucketId }) =>
      run(async () => {
        await ctx.client.request(`/v1/buckets/${bucketId}`, { method: 'DELETE' });
        return textResult(`Bucket ${bucketId} deleted.`);
      }),
  );
}
