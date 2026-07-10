import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, compact, containsRegex } from '../api/query.js';
import { AppContext } from '../context.js';
import type { ToolRegistry } from './registry.js';
import { markdownToTipTapDoc, markdownToTipTapJson } from '../markdown/md-to-tiptap.js';
import { tipTapJsonToMarkdown } from '../markdown/tiptap-to-md.js';
import { TipTapNode } from '../markdown/tiptap-types.js';
import {
  DATE_HINT,
  DESTRUCTIVE,
  Doc,
  MAX_CONTENT_CHARS,
  READ_ONLY,
  WRITE,
  capContent,
  enc,
  jsonResult,
  paginationHeader,
  refId,
  run,
  textResult,
} from './shared.js';

function snippet(content: string, maxLength = 200): string {
  const markdown = tipTapJsonToMarkdown(content).replace(/\s+/g, ' ').trim();
  return markdown.length > maxLength ? `${markdown.slice(0, maxLength)}…` : markdown;
}

function slimNote(note: Doc, withSnippet = true): Doc {
  return compact({
    id: note._id,
    title: note.title,
    icon: note.icon !== '📝' ? note.icon : undefined,
    snippet: withSnippet ? snippet(String(note.content ?? '')) : undefined,
    activity: refId(note.activity),
    objective: refId(note.objective),
    bucket: refId(note.bucket),
    tags: Array.isArray(note.tags) && note.tags.length > 0 ? note.tags.map(refId) : undefined,
    isDescription: note.isDescription === true ? true : undefined,
    updatedAt: note.updatedAt,
  });
}

export function registerNoteTools(server: ToolRegistry, ctx: AppContext): void {
  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description:
        'List notes in the active workspace with a markdown snippet of each. By default, ' +
        'auto-created task/event description notes are hidden unless you filter by activityId.',
      inputSchema: {
        titleContains: z.string().optional().describe('Case-insensitive title search'),
        contentContains: z.string().optional().describe('Case-insensitive content search'),
        activityId: z.string().optional().describe('Notes attached to this task/event'),
        tagId: z.string().optional(),
        includeDescriptions: z
          .boolean()
          .optional()
          .describe('Include auto-created description notes (default false)'),
        updatedAfter: z.string().optional().describe(`Only notes updated after this. ${DATE_HINT}`),
        sort: z.string().optional().describe("Default '-updatedAt'"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Page size (default 20)'),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(async () => {
        const filter: Doc = compact({
          title: input.titleContains ? containsRegex(input.titleContains) : undefined,
          content: input.contentContains ? containsRegex(input.contentContains) : undefined,
          activity: input.activityId,
          tags: input.tagId,
          updatedAt: input.updatedAfter ? { $gte: input.updatedAfter } : undefined,
        });
        if (!input.includeDescriptions && !input.activityId) {
          filter.isDescription = { $ne: true };
        }
        const res = await ctx.client.request<ListResponse<Doc>>('/v1/notes', {
          query: buildListQuery({
            filter,
            sort: input.sort ?? '-updatedAt',
            page: input.page,
            limit: input.limit ?? 20,
          }),
        });
        return jsonResult(
          paginationHeader(ctx, 'notes', res),
          res.data.map((n) => slimNote(n)),
        );
      }),
  );

  server.registerTool(
    'get_note',
    {
      title: 'Get note',
      description: 'Get a note by id with its full content as markdown.',
      inputSchema: { noteId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ noteId }) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/notes/${enc(noteId)}`);
        const note = slimNote(data, false);
        note.content = capContent(tipTapJsonToMarkdown(String(data.content ?? '')));
        return jsonResult(undefined, note);
      }),
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description:
        'Create a note in the active workspace. Content is markdown (headings, lists, task ' +
        'lists, tables, code blocks, links all render in Fokus).',
      inputSchema: {
        title: z.string().describe('Note title'),
        content: z.string().max(MAX_CONTENT_CHARS).describe('Note content in markdown'),
        icon: z.string().optional().describe('Emoji icon (default 📝)'),
        bucketId: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
        activityId: z.string().optional().describe('Attach to a task/event'),
        objectiveId: z.string().optional().describe('Attach to an objective'),
      },
      annotations: WRITE,
    },
    async (input) =>
      run(async () => {
        const { data } = await ctx.client.request<{ data: Doc }>('/v1/notes', {
          method: 'POST',
          body: compact({
            title: input.title,
            content: markdownToTipTapJson(input.content),
            icon: input.icon,
            bucket: input.bucketId,
            tags: input.tagIds,
            activity: input.activityId,
            objective: input.objectiveId,
          }),
        });
        return jsonResult('Note created', slimNote(data));
      }),
  );

  server.registerTool(
    'update_note',
    {
      title: 'Update note',
      description:
        'Update a note. `content` REPLACES the whole note body; use `appendContent` to add ' +
        'to the end instead. Both are markdown.',
      inputSchema: {
        noteId: z.string(),
        title: z.string().optional(),
        icon: z.string().optional(),
        content: z
          .string()
          .max(MAX_CONTENT_CHARS)
          .optional()
          .describe('Replacement content in markdown'),
        appendContent: z
          .string()
          .max(MAX_CONTENT_CHARS)
          .optional()
          .describe('Markdown blocks appended to the note'),
      },
      // content replacement overwrites the existing body
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ noteId, title, icon, content, appendContent }) =>
      run(async () => {
        if (content !== undefined && appendContent !== undefined) {
          return textResult('Pass either `content` or `appendContent`, not both.');
        }
        const body: Doc = compact({ title, icon });
        if (content !== undefined) {
          body.content = markdownToTipTapJson(content);
        } else if (appendContent !== undefined) {
          const { data } = await ctx.client.request<{ data: Doc }>(`/v1/notes/${enc(noteId)}`);
          let existing: TipTapNode;
          try {
            existing = JSON.parse(String(data.content ?? '')) as TipTapNode;
            if (existing?.type !== 'doc') throw new Error('not a doc');
          } catch {
            // plain-text note — preserve it as a paragraph (same fallback as the web editor)
            existing = {
              type: 'doc',
              content: data.content
                ? [{ type: 'paragraph', content: [{ type: 'text', text: String(data.content) }] }]
                : [],
            };
          }
          const addition = markdownToTipTapDoc(appendContent);
          existing.content = [...(existing.content ?? []), ...(addition.content ?? [])];
          body.content = JSON.stringify(existing);
        }
        if (Object.keys(body).length === 0) {
          return textResult('Nothing to update — provide title, icon, content, or appendContent.');
        }
        const { data } = await ctx.client.request<{ data: Doc }>(`/v1/notes/${enc(noteId)}`, {
          method: 'PUT',
          body,
        });
        return jsonResult('Note updated', slimNote(data));
      }),
  );

  server.registerTool(
    'delete_note',
    {
      title: 'Delete note',
      description: 'Permanently delete a note. Cannot be undone.',
      inputSchema: { noteId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ noteId }) =>
      run(async () => {
        await ctx.client.request(`/v1/notes/${enc(noteId)}`, { method: 'DELETE' });
        return textResult(`Note ${noteId} deleted.`);
      }),
  );
}
