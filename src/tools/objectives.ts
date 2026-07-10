import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, compact, containsRegex } from '../api/query.js';
import { AppContext } from '../context.js';
import type { ToolRegistry } from './registry.js';
import { markdownToTipTapJson } from '../markdown/md-to-tiptap.js';
import {
  DATE_HINT,
  DESTRUCTIVE,
  Doc,
  MAX_CONTENT_CHARS,
  enc,
  READ_ONLY,
  UPDATE,
  WRITE,
  fetchDescriptionMarkdown,
  jsonResult,
  paginationHeader,
  refId,
  run,
  textResult,
} from './shared.js';
import { slimTask } from './tasks.js';

const PERIODS = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;

function slimObjective(objective: Doc): Doc {
  return compact({
    id: objective._id,
    title: objective.title,
    period: objective.period,
    start: objective.start,
    end: objective.end,
    isCompleted: objective.isCompleted,
    bucket: refId(objective.bucket),
    progress: objective.progressPercentage ?? objective.progress,
    rolloverCount: objective.rolloverCount,
  });
}

export function registerObjectiveTools(server: ToolRegistry, ctx: AppContext): void {
  server.registerTool(
    'list_objectives',
    {
      title: 'List objectives',
      description:
        "List objectives (goals) in the active workspace. scope 'current' lists active " +
        "objectives; 'history' lists past periods.",
      inputSchema: {
        scope: z.enum(['current', 'history']).optional().describe("Default 'current'"),
        period: z.enum(PERIODS).optional(),
        status: z.enum(['open', 'completed', 'all']).optional().describe("Default 'all'"),
        titleContains: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20)'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        if (input.scope === 'history') {
          const qs = new URLSearchParams();
          if (input.status !== 'open') qs.set('includeCompleted', 'true');
          qs.set('limit', String(input.limit ?? 20));
          if (input.page && input.page > 1) {
            qs.set('offset', String((input.page - 1) * (input.limit ?? 20)));
          }
          const res = await ctx.client.request<{ data: Doc[] }>('/v1/objectives/history', {
            query: qs.toString(),
          });
          return jsonResult(
            `${ctx.session.workspaceHeader()} — ${res.data.length} past objectives`,
            res.data.map(slimObjective),
          );
        }
        const filter: Doc = compact({
          period: input.period,
          title: input.titleContains ? containsRegex(input.titleContains) : undefined,
        });
        if (input.status === 'open') filter.isCompleted = false;
        if (input.status === 'completed') filter.isCompleted = true;
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/objectives', {
          query: buildListQuery({
            filter,
            sort: '-createdAt',
            page: input.page,
            limit: input.limit ?? 20,
          }),
        });
        return jsonResult(paginationHeader(ctx, 'objectives', res), res.data.map(slimObjective));
      }),
  );

  server.registerTool(
    'get_objective',
    {
      title: 'Get objective',
      description:
        'Get an objective by id, including its description (markdown) and linked tasks ' +
        'when available.',
      inputSchema: { objectiveId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ objectiveId }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(
          `/v1/objectives/${enc(objectiveId)}`,
        );
        const objective = slimObjective(data);
        if (Array.isArray(data.tasks) && data.tasks.length > 0) {
          objective.tasks = data.tasks.map((t: Doc) => (typeof t === 'string' ? t : slimTask(t)));
        }
        const description = await fetchDescriptionMarkdown(ctx, objectiveId).catch(() => undefined);
        if (description) objective.description = description;
        return jsonResult(undefined, objective);
      }),
  );

  server.registerTool(
    'create_objective',
    {
      title: 'Create objective',
      description:
        'Create an objective (goal) for a period. start/end should span the period, e.g. ' +
        'Monday–Sunday for weekly objectives.',
      inputSchema: {
        title: z.string(),
        period: z.enum(PERIODS),
        start: z.string().describe(`Period start. ${DATE_HINT}`),
        end: z.string().describe(`Period end. ${DATE_HINT}`),
        bucketId: z.string().optional(),
        description: z
          .string()
          .max(MAX_CONTENT_CHARS)
          .optional()
          .describe('Description in markdown'),
      },
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/objectives', {
          method: 'POST',
          body: compact({
            title: input.title,
            period: input.period,
            start: input.start,
            end: input.end,
            // required by the API on create
            isCompleted: false,
            bucket: input.bucketId,
            descriptionNote: input.description
              ? markdownToTipTapJson(input.description)
              : undefined,
          }),
        });
        return jsonResult('Objective created', slimObjective(data));
      }),
  );

  server.registerTool(
    'update_objective',
    {
      title: 'Update objective',
      description: 'Update an objective (rename, complete, change period bounds...).',
      inputSchema: {
        objectiveId: z.string(),
        title: z.string().optional(),
        period: z.enum(PERIODS).optional(),
        start: z.string().optional().describe(DATE_HINT),
        end: z.string().optional().describe(DATE_HINT),
        isCompleted: z.boolean().optional(),
        bucketId: z.string().optional(),
      },
      annotations: UPDATE,
    },
    async ({ objectiveId, bucketId, ...input }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(
          `/v1/objectives/${enc(objectiveId)}`,
          {
            method: 'PUT',
            body: compact({ ...input, bucket: bucketId }),
          },
        );
        return jsonResult('Objective updated', slimObjective(data));
      }),
  );

  server.registerTool(
    'rollover_objective',
    {
      title: 'Rollover objective',
      description:
        'Carry an unfinished objective over to the next period (or an explicit target ' +
        'period), bringing its open tasks along.',
      inputSchema: {
        objectiveId: z.string(),
        targetPeriod: z
          .object({
            type: z.enum(PERIODS),
            year: z.number().int(),
            value: z
              .number()
              .int()
              .describe('Week number 1-53, month 1-12, quarter 1-4, or the year itself'),
          })
          .optional()
          .describe('Defaults to the next period after the objective'),
      },
      annotations: WRITE,
    },
    async ({ objectiveId, targetPeriod }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(
          `/v1/objectives/${enc(objectiveId)}/rollover`,
          { method: 'POST', body: targetPeriod ? { targetPeriod } : {} },
        );
        return jsonResult('Objective rolled over', slimObjective(data ?? {}));
      }),
  );

  server.registerTool(
    'delete_objective',
    {
      title: 'Delete objective',
      description:
        'Permanently delete an objective. Linked tasks are kept but unlinked. Cannot be undone.',
      inputSchema: { objectiveId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ objectiveId }) =>
      run(async () => {
        await ctx.client.request(`/v1/objectives/${enc(objectiveId)}`, { method: 'DELETE' });
        return textResult(`Objective ${objectiveId} deleted.`);
      }),
  );
}
