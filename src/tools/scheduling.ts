import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { compact } from '../api/query.js';
import { AppContext } from '../context.js';
import { DATE_HINT, Doc, READ_ONLY, WRITE, jsonResult, run, textResult } from './shared.js';

/**
 * Fokus auto-scheduling: the backend prepares tasks/events/preferences and submits them to
 * the Timefold constraint solver, returning a job id. Poll the job, then apply the result.
 */
export function registerSchedulingTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'auto_schedule_tasks',
    {
      title: 'Auto-schedule tasks',
      description:
        "Run Fokus's AI auto-scheduler: it places the user's unscheduled tasks into free " +
        'calendar slots within the range, respecting energy levels, priorities, deadlines, ' +
        'and working hours. Returns a job id — poll with get_scheduling_job until done, ' +
        'then call apply_scheduling_job to write the plan to the calendar.',
      inputSchema: {
        rangeStart: z.string().describe(`Scheduling window start. ${DATE_HINT}`),
        rangeEnd: z.string().describe(`Scheduling window end. ${DATE_HINT}`),
        timeZone: z.string().optional().describe("IANA timezone (default: the user's)"),
      },
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const result = await ctx.client.request<Doc>('/v1/scheduling/auto-schedule', {
          method: 'POST',
          body: compact({
            rangeStart: input.rangeStart,
            rangeEnd: input.rangeEnd,
            timeZone: input.timeZone ?? ctx.session.timezone,
          }),
        });
        const data = (result?.data ?? result) as Doc;
        return jsonResult(
          'Scheduling job started — poll get_scheduling_job, then apply_scheduling_job',
          compact({ jobId: data.jobId ?? data.id, status: data.status }),
        );
      }),
  );

  server.registerTool(
    'get_scheduling_job',
    {
      title: 'Get scheduling job',
      description:
        'Check an auto-scheduling job. Returns status, and when finished the proposed ' +
        'assignments (which tasks go where).',
      inputSchema: { jobId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ jobId }) =>
      run(async () => {
        const status = await ctx.client.request<Doc>(
          `/v1/scheduling/jobs/${encodeURIComponent(jobId)}/status`,
        );
        const statusData = (status?.data ?? status) as Doc;
        if (String(statusData.status).toLowerCase() === 'completed') {
          const full = await ctx.client
            .request<Doc>(`/v1/scheduling/jobs/${encodeURIComponent(jobId)}`)
            .catch(() => undefined);
          if (full) return jsonResult('Job completed', (full.data ?? full) as Doc);
        }
        return jsonResult(undefined, statusData);
      }),
  );

  server.registerTool(
    'apply_scheduling_job',
    {
      title: 'Apply scheduling job',
      description:
        "Apply a completed auto-scheduling job's proposal — tasks get their start/end times " +
        'written to the calendar.',
      inputSchema: { jobId: z.string() },
      annotations: WRITE,
    },
    async ({ jobId }) =>
      run(async () => {
        const result = await ctx.client.request<Doc>(
          `/v1/scheduling/jobs/${encodeURIComponent(jobId)}/apply`,
          { method: 'POST' },
        );
        const data = (result?.data ?? result ?? {}) as Doc;
        return jsonResult('Schedule applied', data);
      }),
  );

  server.registerTool(
    'cancel_scheduling_job',
    {
      title: 'Cancel scheduling job',
      description: 'Cancel a running auto-scheduling job.',
      inputSchema: { jobId: z.string() },
      annotations: WRITE,
    },
    async ({ jobId }) =>
      run(async () => {
        await ctx.client.request(`/v1/scheduling/jobs/${encodeURIComponent(jobId)}`, {
          method: 'DELETE',
        });
        return textResult(`Scheduling job ${jobId} cancelled.`);
      }),
  );
}
