import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AppContext } from '../context.js';

export function registerPrompts(server: McpServer, ctx: AppContext): void {
  server.registerPrompt(
    'daily_planning',
    {
      title: 'Plan my day',
      description: 'Review today’s schedule and open tasks, then build a realistic plan.',
      argsSchema: {
        date: z.string().optional().describe('Day to plan, YYYY-MM-DD (default: today)'),
      },
    },
    ({ date }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Help me plan ${date ? `my day on ${date}` : 'my day today'} in Fokus (timezone: ${ctx.session.timezone}).`,
              '',
              '1. Call get_current_datetime, then get_schedule for the day to see events and planned tasks.',
              '2. Call list_tasks (status open) to find overdue and unplanned tasks that deserve a slot.',
              '3. Propose a realistic plan: what to do when, respecting existing events, task priorities, energy levels, and estimated times. Flag anything overcommitted.',
              '4. If I approve, apply it — set doDate/start on the chosen tasks (update_task), or run auto_schedule_tasks for the day and apply the result.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'weekly_review',
    {
      title: 'Weekly review',
      description: 'Summarize last week’s progress and set up the coming week.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Run a weekly review of my Fokus workspace (timezone: ${ctx.session.timezone}).`,
              '',
              '1. Call get_current_datetime to anchor the week (last 7 days and the coming 7).',
              '2. Completed work: list_tasks with status completed for the past week; celebrate the wins briefly.',
              '3. Slipped work: open tasks with dueDate in the past (list_tasks with dueBefore now) and stale doDates.',
              '4. Objectives: list_objectives — which progressed, which stalled? Suggest rollover_objective where sensible.',
              '5. Coming week: get_schedule for the next 7 days; surface conflicts and free capacity.',
              '6. Finish with 3-5 concrete suggestions (reschedules, priorities, tasks to drop) and offer to apply them.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
