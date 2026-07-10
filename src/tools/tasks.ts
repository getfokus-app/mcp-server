import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, compact, containsRegex, dateRange } from '../api/query.js';
import { AppContext } from '../context.js';
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
  describeError,
  fetchDescriptionMarkdown,
  jsonResult,
  paginationHeader,
  refId,
  run,
  textResult,
} from './shared.js';

export function slimTask(task: Doc): Doc {
  return compact({
    id: task._id,
    title: task.title,
    isCompleted: task.isCompleted,
    priority: task.priority,
    energyLevel: task.energyLevel,
    estimatedTime: task.estimatedTime,
    dueDate: task.dueDate,
    doDate: task.doDate,
    start: task.start,
    end: task.end,
    deadlineMode: task.deadlineMode,
    bucket: refId(task.bucket),
    objective: refId(task.objective),
    parent: refId(task.parent),
    calendar: refId(task.calendar),
    tags: Array.isArray(task.tags) && task.tags.length > 0 ? task.tags.map(refId) : undefined,
    isPinned: task.isPinned === true ? true : undefined,
    excludeFromScheduling: task.excludeFromScheduling === true ? true : undefined,
    recurringPattern: task.recurringPattern,
    blockedBy:
      Array.isArray(task.blockedBy) && task.blockedBy.length > 0
        ? task.blockedBy.map(refId)
        : undefined,
    createdAt: task.createdAt,
  });
}

const createTaskFields = {
  title: z.string().describe('Task title'),
  description: z
    .string()
    .max(MAX_CONTENT_CHARS)
    .optional()
    .describe('Task description in markdown'),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  energyLevel: z
    .enum(['light', 'moderate', 'extensive'])
    .optional()
    .describe('Energy the task requires'),
  estimatedTime: z.number().int().positive().optional().describe('Estimated duration in minutes'),
  dueDate: z.string().optional().describe(`Deadline. ${DATE_HINT}`),
  doDate: z.string().optional().describe(`Day the user plans to work on it. ${DATE_HINT}`),
  start: z
    .string()
    .optional()
    .describe(`Scheduled start; setting it pins the task to that time slot. ${DATE_HINT}`),
  end: z.string().optional().describe(`Scheduled end. ${DATE_HINT}`),
  deadlineMode: z
    .enum(['soft', 'hard'])
    .optional()
    .describe('Whether the deadline is soft or hard'),
  bucketId: z.string().optional().describe('Bucket (project/category) id — see list_buckets'),
  objectiveId: z.string().optional().describe('Objective id to link — see list_objectives'),
  parentId: z.string().optional().describe('Parent task id (makes this a subtask)'),
  calendarId: z.string().optional().describe('Calendar id — see list_calendars'),
  tagIds: z.array(z.string()).optional().describe('Tag ids — see list_tags'),
  recurringPattern: z
    .string()
    .optional()
    .describe(
      'RRULE set incl. DTSTART to make the task recurring, e.g. ' +
        '"DTSTART:20260713T090000Z\\nRRULE:FREQ=WEEKLY;BYDAY=MO"',
    ),
  excludeFromScheduling: z.boolean().optional().describe('Exclude from the auto-scheduler'),
};

type CreateTaskInput = {
  [K in keyof typeof createTaskFields]?: z.infer<(typeof createTaskFields)[K]> | null;
};

function toTaskDto(input: CreateTaskInput): Doc {
  return compact({
    title: input.title,
    priority: input.priority,
    energyLevel: input.energyLevel,
    estimatedTime: input.estimatedTime,
    dueDate: input.dueDate,
    doDate: input.doDate,
    start: input.start,
    end: input.end,
    deadlineMode: input.deadlineMode,
    bucket: input.bucketId,
    objective: input.objectiveId,
    parent: input.parentId,
    calendar: input.calendarId,
    tags: input.tagIds,
    recurringPattern: input.recurringPattern,
    excludeFromScheduling: input.excludeFromScheduling,
    descriptionNote: input.description ? markdownToTipTapJson(input.description) : undefined,
  });
}

export function registerTaskTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks in the active workspace with filters. Defaults to open (not completed) ' +
        'tasks sorted by newest first. Recurring tasks are included; filter them with `recurring`.',
      inputSchema: {
        status: z
          .enum(['open', 'completed', 'all'])
          .optional()
          .describe("Completion filter (default 'open')"),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        energyLevel: z.enum(['light', 'moderate', 'extensive']).optional(),
        bucketId: z.string().optional(),
        parentId: z.string().optional().describe('List subtasks of this task'),
        calendarId: z.string().optional(),
        tagId: z.string().optional(),
        titleContains: z.string().optional().describe('Case-insensitive title search'),
        dueAfter: z.string().optional().describe(`Due date lower bound. ${DATE_HINT}`),
        dueBefore: z.string().optional().describe(`Due date upper bound. ${DATE_HINT}`),
        doDateFrom: z.string().optional().describe(`Do-date lower bound. ${DATE_HINT}`),
        doDateTo: z.string().optional().describe(`Do-date upper bound. ${DATE_HINT}`),
        recurring: z
          .boolean()
          .optional()
          .describe('true = only recurring tasks, false = exclude recurring tasks'),
        sort: z
          .string()
          .optional()
          .describe(
            "Sort field, '-' prefix for descending (default '-createdAt'). " +
              'Fields: createdAt, title, doDate, dueDate, priority, start',
          ),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Page size (default 20)'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        const filter: Doc = compact({
          priority: input.priority,
          energyLevel: input.energyLevel,
          bucket: input.bucketId,
          parent: input.parentId,
          calendar: input.calendarId,
          tags: input.tagId,
          title: input.titleContains ? containsRegex(input.titleContains) : undefined,
          dueDate: dateRange(input.dueAfter, input.dueBefore),
          doDate: dateRange(input.doDateFrom, input.doDateTo),
        });
        const status = input.status ?? 'open';
        if (status !== 'all') filter.isCompleted = status === 'completed';
        if (input.recurring !== undefined) {
          filter.recurringStartDate = { $exists: input.recurring };
        }
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/tasks', {
          query: buildListQuery({
            filter,
            sort: input.sort ?? '-createdAt',
            page: input.page,
            limit: input.limit ?? 20,
          }),
        });
        return jsonResult(paginationHeader(ctx, 'tasks', res), res.data.map(slimTask));
      }),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description:
        'Get full details of a task by id, including its description (as markdown) by default.',
      inputSchema: {
        taskId: z.string(),
        includeDescription: z.boolean().optional().describe('Default true'),
      },
      annotations: READ_ONLY,
    },
    async ({ taskId, includeDescription }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/tasks/${enc(taskId)}`);
        const task = slimTask(data);
        if (includeDescription !== false) {
          const description = await fetchDescriptionMarkdown(ctx, taskId);
          if (description) task.description = description;
        }
        return jsonResult(undefined, task);
      }),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        'Create a task in the active workspace. Setting `start` pins the task to that time; ' +
        'otherwise the auto-scheduler can place it. Use `recurringPattern` for recurring tasks.',
      inputSchema: createTaskFields,
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/tasks', {
          method: 'POST',
          body: toTaskDto(input),
        });
        return jsonResult('Task created', slimTask(data));
      }),
  );

  server.registerTool(
    'bulk_create_tasks',
    {
      title: 'Bulk create tasks',
      description:
        'Create up to 25 tasks in one call (e.g. breaking down a project). Tasks are created ' +
        'sequentially; the result reports success or failure per task.',
      inputSchema: {
        tasks: z.array(z.object(createTaskFields)).min(1).max(25),
      },
      annotations: WRITE,
    },
    async ({ tasks }) =>
      run(async () => {
        const results: Doc[] = [];
        for (const [index, taskInput] of tasks.entries()) {
          try {
            const { data } = await ctx.client.request<{ data: Doc }>('/v1/tasks', {
              method: 'POST',
              body: toTaskDto(taskInput),
            });
            results.push({ index, id: data._id, title: data.title, created: true });
          } catch (error) {
            results.push({
              index,
              title: taskInput.title,
              created: false,
              error: describeError(error),
            });
          }
        }
        const created = results.filter((r) => r.created).length;
        return jsonResult(`Created ${created}/${tasks.length} tasks`, results);
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description:
        'Update task fields. Only provided fields change; `description` (markdown) replaces ' +
        'the task description. Set start/end to null to unschedule.',
      inputSchema: {
        taskId: z.string(),
        title: z.string().optional(),
        description: z
          .string()
          .max(MAX_CONTENT_CHARS)
          .optional()
          .describe('New description in markdown (replaces)'),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        energyLevel: z.enum(['light', 'moderate', 'extensive']).optional(),
        estimatedTime: z.number().int().positive().optional(),
        dueDate: z.string().nullable().optional().describe(`${DATE_HINT} Null clears it.`),
        doDate: z.string().nullable().optional().describe(`${DATE_HINT} Null clears it.`),
        start: z.string().nullable().optional().describe(`${DATE_HINT} Null unschedules.`),
        end: z.string().nullable().optional().describe(`${DATE_HINT} Null unschedules.`),
        deadlineMode: z.enum(['soft', 'hard']).optional(),
        bucketId: z.string().optional(),
        objectiveId: z.string().optional(),
        parentId: z.string().optional(),
        calendarId: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
        recurringPattern: z.string().optional(),
        isPinned: z.boolean().optional(),
        excludeFromScheduling: z.boolean().optional(),
        blockedBy: z.array(z.string()).optional().describe('Task ids that block this task'),
      },
      annotations: UPDATE,
    },
    async ({ taskId, blockedBy, isPinned, ...input }) =>
      run(async () => {
        const dto = toTaskDto(input);
        if (input.dueDate === null) dto.dueDate = null;
        if (input.doDate === null) dto.doDate = null;
        if (input.start === null) dto.start = null;
        if (input.end === null) dto.end = null;
        if (isPinned !== undefined) dto.isPinned = isPinned;
        if (blockedBy !== undefined) dto.blockedBy = blockedBy;
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/tasks/${enc(taskId)}`, {
          method: 'PUT',
          body: dto,
        });
        return jsonResult('Task updated', slimTask(data));
      }),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description: 'Mark a task as completed (or uncompleted with completed=false).',
      inputSchema: {
        taskId: z.string(),
        completed: z.boolean().optional().describe('Default true'),
      },
      annotations: UPDATE,
    },
    async ({ taskId, completed }) =>
      run(async () => {
        const isCompleted = completed !== false;
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/tasks/${enc(taskId)}`, {
          method: 'PUT',
          body: { isCompleted },
        });
        return textResult(`Task "${data.title}" marked ${isCompleted ? 'completed' : 'open'}.`);
      }),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Permanently delete a task (and its subtask links). This cannot be undone.',
      inputSchema: { taskId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ taskId }) =>
      run(async () => {
        await ctx.client.request(`/v1/tasks/${enc(taskId)}`, { method: 'DELETE' });
        return textResult(`Task ${taskId} deleted.`);
      }),
  );
}
