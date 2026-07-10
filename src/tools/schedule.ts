import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, compact, dateRange } from '../api/query.js';
import { AppContext } from '../context.js';
import type { ToolRegistry } from './registry.js';
import { DATE_HINT, Doc, READ_ONLY, jsonResult, run } from './shared.js';
import { slimEvent } from './events.js';
import { slimTask } from './tasks.js';

/** Local YYYY-MM-DD in the user's timezone for grouping agenda items by day. */
function dayKey(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function registerScheduleTools(server: ToolRegistry, ctx: AppContext): void {
  server.registerTool(
    'get_schedule',
    {
      title: 'Get schedule',
      description:
        "The user's agenda for a date range: calendar events plus tasks planned (doDate) or " +
        'scheduled (start) in the range, grouped by day. Ideal for "what does my day/week look like".',
      inputSchema: {
        startDate: z.string().describe(`Range start (inclusive). ${DATE_HINT}`),
        endDate: z.string().describe(`Range end (inclusive). ${DATE_HINT}`),
        includeCompleted: z
          .boolean()
          .optional()
          .describe('Include completed tasks (default false)'),
      },
      annotations: READ_ONLY,
    },
    async ({ startDate, endDate, includeCompleted }) =>
      run(async () => {
        const completedFilter = includeCompleted ? {} : { isCompleted: false };
        const [byDoDate, byStart, events] = await Promise.all([
          ctx.client.request<ListResponse<Doc>>('/v1/tasks', {
            query: buildListQuery({
              filter: { ...completedFilter, doDate: dateRange(startDate, endDate) },
              sort: 'doDate',
              limit: 100,
            }),
          }),
          ctx.client.request<ListResponse<Doc>>('/v1/tasks', {
            query: buildListQuery({
              filter: { ...completedFilter, start: dateRange(startDate, endDate) },
              sort: 'start',
              limit: 100,
            }),
          }),
          ctx.client.request<ListResponse<Doc>>('/v1/events', {
            query: buildListQuery({
              filter: { start: dateRange(startDate, endDate) },
              sort: 'start',
              limit: 100,
            }),
          }),
        ]);

        const tasks = new Map<string, Doc>();
        for (const task of [...byDoDate.data, ...byStart.data]) {
          tasks.set(String(task._id), task);
        }

        const timeZone = ctx.session.timezone;
        const days: Record<string, { events: Doc[]; scheduledTasks: Doc[]; plannedTasks: Doc[] }> =
          {};
        const day = (key: string) =>
          (days[key] ??= { events: [], scheduledTasks: [], plannedTasks: [] });

        for (const event of events.data) {
          if (!event.start) continue;
          day(dayKey(String(event.start), timeZone)).events.push(slimEvent(event));
        }
        for (const task of tasks.values()) {
          const slim = slimTask(task);
          if (task.start) {
            day(dayKey(String(task.start), timeZone)).scheduledTasks.push(slim);
          } else if (task.doDate) {
            day(dayKey(String(task.doDate), timeZone)).plannedTasks.push(slim);
          }
        }

        const sortedDays = Object.fromEntries(
          Object.entries(days)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [
              key,
              compact({
                events: value.events.length ? value.events : undefined,
                scheduledTasks: value.scheduledTasks.length ? value.scheduledTasks : undefined,
                plannedTasks: value.plannedTasks.length ? value.plannedTasks : undefined,
              }),
            ]),
        );

        const header =
          `${ctx.session.workspaceHeader()} — schedule ${startDate} → ${endDate} ` +
          `(${events.data.length} events, ${tasks.size} tasks; times shown as stored, ` +
          `days grouped in ${timeZone})`;
        return jsonResult(
          header,
          Object.keys(sortedDays).length > 0 ? sortedDays : { message: 'Nothing scheduled.' },
        );
      }),
  );
}
