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
  fetchDescriptionMarkdown,
  jsonResult,
  paginationHeader,
  refId,
  run,
  textResult,
} from './shared.js';

export function slimEvent(event: Doc): Doc {
  return compact({
    id: event._id,
    title: event.title,
    start: event.start,
    end: event.end,
    isAllDay: event.isAllDay === true ? true : undefined,
    eventType: event.eventType,
    status: event.status,
    calendar: refId(event.calendar),
    bucket: refId(event.bucket),
    location: event.location?.name ?? event.location?.address,
    attendees:
      Array.isArray(event.attendees) && event.attendees.length > 0
        ? event.attendees.map((a: Doc) => a.email ?? a.name).filter(Boolean)
        : undefined,
    recurringPattern: event.recurringPattern,
    excludeFromScheduling: event.excludeFromScheduling === true ? true : undefined,
  });
}

async function resolveCalendarId(ctx: AppContext): Promise<string | undefined> {
  const res = await ctx.client.request<ListResponse<Doc>>('/v1/calendars', {
    query: buildListQuery({ limit: 100 }),
  });
  const calendars = res.data ?? [];
  return (
    refId(calendars.find((c) => c.primary === true)) ??
    refId(calendars.find((c) => c.enabled !== false)) ??
    refId(calendars[0])
  );
}

const eventFields = {
  title: z.string().describe('Event title'),
  start: z.string().describe(`Event start. ${DATE_HINT}`),
  end: z.string().describe(`Event end. ${DATE_HINT}`),
  isAllDay: z.boolean().optional(),
  eventType: z.enum(['default', 'outOfOffice', 'focusTime', 'other']).optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  calendarId: z
    .string()
    .optional()
    .describe("Calendar id — defaults to the user's primary calendar"),
  bucketId: z.string().optional(),
  description: z
    .string()
    .max(MAX_CONTENT_CHARS)
    .optional()
    .describe('Event description in markdown'),
  recurringPattern: z.string().optional().describe('RRULE set incl. DTSTART for recurring events'),
  excludeFromScheduling: z
    .boolean()
    .optional()
    .describe('Ignore this event when auto-scheduling tasks'),
};

type EventInput = Partial<{ [K in keyof typeof eventFields]: z.infer<(typeof eventFields)[K]> }>;

function toEventDto(ctx: AppContext, input: EventInput, calendarId?: string): Doc {
  const dto = compact({
    title: input.title,
    start: input.start,
    end: input.end,
    isAllDay: input.isAllDay,
    eventType: input.eventType,
    status: input.status,
    calendar: calendarId ?? input.calendarId,
    bucket: input.bucketId,
    recurringPattern: input.recurringPattern,
    excludeFromScheduling: input.excludeFromScheduling,
    descriptionNote: input.description ? markdownToTipTapJson(input.description) : undefined,
  });
  // The API requires timezones for timed events on a calendar
  if (dto.calendar && typeof dto.start === 'string' && dto.start.includes('T')) {
    dto.startTimeZone = ctx.session.timezone;
  }
  if (dto.calendar && typeof dto.end === 'string' && dto.end.includes('T')) {
    dto.endTimeZone = ctx.session.timezone;
  }
  return dto;
}

export function registerEventTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description:
        'List calendar events in the active workspace, usually within a date range. ' +
        'Sorted by start time ascending by default.',
      inputSchema: {
        startFrom: z.string().optional().describe(`Range start. ${DATE_HINT}`),
        startTo: z.string().optional().describe(`Range end. ${DATE_HINT}`),
        calendarId: z.string().optional(),
        bucketId: z.string().optional(),
        titleContains: z.string().optional().describe('Case-insensitive title search'),
        sort: z.string().optional().describe("Default 'start'"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 50)'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        const filter: Doc = compact({
          calendar: input.calendarId,
          bucket: input.bucketId,
          title: input.titleContains ? containsRegex(input.titleContains) : undefined,
          start: dateRange(input.startFrom, input.startTo),
        });
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/events', {
          query: buildListQuery({
            filter,
            sort: input.sort ?? 'start',
            page: input.page,
            limit: input.limit ?? 50,
          }),
        });
        return jsonResult(paginationHeader(ctx, 'events', res), res.data.map(slimEvent));
      }),
  );

  server.registerTool(
    'get_event',
    {
      title: 'Get event',
      description:
        'Get full details of a calendar event by id, including its description (markdown).',
      inputSchema: {
        eventId: z.string(),
        includeDescription: z.boolean().optional().describe('Default true'),
      },
      annotations: READ_ONLY,
    },
    async ({ eventId, includeDescription }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/events/${enc(eventId)}`);
        const event = slimEvent(data);
        if (includeDescription !== false) {
          const description = await fetchDescriptionMarkdown(ctx, eventId);
          if (description) event.description = description;
        }
        return jsonResult(undefined, event);
      }),
  );

  server.registerTool(
    'create_event',
    {
      title: 'Create event',
      description:
        "Create a calendar event. Defaults to the user's primary calendar when no " +
        'calendarId is given. Times are interpreted in the offset you provide.',
      inputSchema: eventFields,
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const calendarId = input.calendarId ?? (await resolveCalendarId(ctx));
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/events', {
          method: 'POST',
          body: toEventDto(ctx, input, calendarId),
        });
        return jsonResult('Event created', slimEvent(data));
      }),
  );

  server.registerTool(
    'update_event',
    {
      title: 'Update event',
      description:
        'Update event fields (reschedule, rename, change status...). Only provided fields change.',
      inputSchema: {
        eventId: z.string(),
        title: z.string().optional(),
        start: z.string().optional().describe(DATE_HINT),
        end: z.string().optional().describe(DATE_HINT),
        isAllDay: z.boolean().optional(),
        eventType: z.enum(['default', 'outOfOffice', 'focusTime', 'other']).optional(),
        status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
        calendarId: z.string().optional(),
        bucketId: z.string().optional(),
        description: z
          .string()
          .max(MAX_CONTENT_CHARS)
          .optional()
          .describe('New description in markdown (replaces)'),
        excludeFromScheduling: z.boolean().optional(),
      },
      annotations: UPDATE,
    },
    async ({ eventId, ...input }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/events/${enc(eventId)}`, {
          method: 'PUT',
          body: toEventDto(ctx, input),
        });
        return jsonResult('Event updated', slimEvent(data));
      }),
  );

  server.registerTool(
    'delete_event',
    {
      title: 'Delete event',
      description:
        'Permanently delete a calendar event. For events synced from external calendars ' +
        '(Google, Outlook...) this also removes them there. Cannot be undone.',
      inputSchema: { eventId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ eventId }) =>
      run(async () => {
        await ctx.client.request(`/v1/events/${enc(eventId)}`, { method: 'DELETE' });
        return textResult(`Event ${eventId} deleted.`);
      }),
  );
}
