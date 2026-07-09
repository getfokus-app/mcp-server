import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ListResponse } from '../api/http.js';
import { buildListQuery, containsRegex } from '../api/query.js';
import { AppContext } from '../context.js';
import { Doc, READ_ONLY, jsonResult, run } from './shared.js';

const TYPES = ['tasks', 'events', 'notes', 'objectives', 'buckets', 'tags'] as const;
type SearchType = (typeof TYPES)[number];

interface SearchTarget {
  path: string;
  /** Fields to regex-match; one request per field, merged and deduped. */
  fields: string[];
  slim: (doc: Doc) => Doc;
}

const TARGETS: Record<SearchType, SearchTarget> = {
  tasks: {
    path: '/v1/tasks',
    fields: ['title'],
    slim: (t) => ({ id: t._id, title: t.title, isCompleted: t.isCompleted, doDate: t.doDate }),
  },
  events: {
    path: '/v1/events',
    fields: ['title'],
    slim: (e) => ({ id: e._id, title: e.title, start: e.start, end: e.end }),
  },
  notes: {
    path: '/v1/notes',
    fields: ['title', 'content'],
    slim: (n) => ({ id: n._id, title: n.title, updatedAt: n.updatedAt }),
  },
  objectives: {
    path: '/v1/objectives',
    fields: ['title'],
    slim: (o) => ({ id: o._id, title: o.title, period: o.period, isCompleted: o.isCompleted }),
  },
  buckets: {
    path: '/v1/buckets',
    fields: ['title'],
    slim: (b) => ({ id: b._id, title: b.title }),
  },
  tags: {
    path: '/v1/tags',
    fields: ['name'],
    slim: (t) => ({ id: t._id, name: t.name }),
  },
};

export function registerSearchTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    'search',
    {
      title: 'Search Fokus',
      description:
        'Search across the active workspace by title (and note content). Returns matches ' +
        'grouped by type. Use the specific list_* tools for filtered/paginated queries.',
      inputSchema: {
        query: z.string().min(1).describe('Text to search for (case-insensitive)'),
        types: z.array(z.enum(TYPES)).optional().describe('Restrict to these types (default: all)'),
        limit: z.number().int().min(1).max(25).optional().describe('Max per type (default 10)'),
      },
      annotations: READ_ONLY,
    },
    async ({ query, types, limit }) =>
      run(async () => {
        const perType = limit ?? 10;
        const searchTypes = types?.length ? types : [...TYPES];

        const grouped: Record<string, Doc[]> = {};
        await Promise.all(
          searchTypes.map(async (type) => {
            const target = TARGETS[type];
            const byField = await Promise.all(
              target.fields.map((field) =>
                ctx.client
                  .request<ListResponse<Doc>>(target.path, {
                    query: buildListQuery({
                      filter: { [field]: containsRegex(query) },
                      limit: perType,
                    }),
                  })
                  .then((res) => res.data ?? [])
                  .catch(() => [] as Doc[]),
              ),
            );
            const seen = new Set<string>();
            const merged: Doc[] = [];
            for (const doc of byField.flat()) {
              const id = String(doc._id);
              if (seen.has(id)) continue;
              seen.add(id);
              merged.push(target.slim(doc));
              if (merged.length >= perType) break;
            }
            if (merged.length > 0) grouped[type] = merged;
          }),
        );

        const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0);
        return jsonResult(
          `${ctx.session.workspaceHeader()} — ${total} matches for "${query}"`,
          total > 0 ? grouped : { message: 'No matches found.' },
        );
      }),
  );
}
