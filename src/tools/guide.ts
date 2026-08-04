import { z } from 'zod';

import { AppContext } from '../context.js';
import type { ToolRegistry } from './registry.js';
import { Doc, READ_ONLY, jsonResult, run } from './shared.js';

interface GuideHit {
  title: string;
  section?: string;
  url: string;
  breadcrumb: string[];
  content: string;
  score: number;
}

export function registerGuideTools(server: ToolRegistry, ctx: AppContext): void {
  server.registerTool(
    'search_fokus_guide',
    {
      title: 'Search the Fokus user guide',
      description:
        'Search the official Fokus user guide (guide.getfokus.com) for how the app works — ' +
        'features, settings, integrations, add-ons, limits, and step-by-step instructions.\n\n' +
        'Use this for questions about Fokus itself ("how do I…", "where is…", "what does X do", ' +
        '"does Fokus support…"). It knows nothing about the user\'s own tasks, events or notes — ' +
        'use `search` or the list_* tools for those.\n\n' +
        'Returns guide sections with a citable URL deep-linked to the exact heading. Answer from ' +
        'the returned text only; do not invent menu paths or setting names.',
      inputSchema: {
        query: z
          .string()
          .min(3)
          .max(300)
          .describe('The product or how-to question, in natural language'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe('Max guide sections to return (default 5)'),
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) =>
      run(async () => {
        const params = new URLSearchParams({ query });
        if (limit) params.set('limit', String(limit));

        const res = await ctx.client.request<{ data: GuideHit[] }>('/v1/ai/guide/search', {
          query: params.toString(),
        });

        const hits = res.data ?? [];

        if (hits.length === 0) {
          return jsonResult(`No guide section covers "${query}"`, {
            message:
              'The Fokus user guide has no section covering this. Say so rather than guessing; ' +
              'the full guide is at https://guide.getfokus.com.',
          });
        }

        return jsonResult(
          `${hits.length} guide section(s) for "${query}"`,
          hits.map((hit): Doc => ({
            title: hit.title,
            section: hit.section,
            url: hit.url,
            breadcrumb: hit.breadcrumb,
            content: hit.content,
          })),
        );
      }),
  );
}
