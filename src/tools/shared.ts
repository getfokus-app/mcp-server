import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

import { ApiError, ListResponse } from '../api/http.js';
import { buildListQuery } from '../api/query.js';
import { AuthRequiredError } from '../auth/token-manager.js';
import { AppContext } from '../context.js';
import { tipTapJsonToMarkdown } from '../markdown/tiptap-to-md.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = Record<string, any>;

/**
 * URL-encode an id before interpolating it into a request path. Tool ids come
 * from LLM calls and are otherwise unconstrained strings; without encoding an
 * id like "../workspaces/<id>" would traverse to a different resource type
 * (e.g. delete_task escalating to deleting a workspace), and "x?foo=bar" would
 * smuggle query parameters. encodeURIComponent turns "/" and "?" inert.
 */
export function enc(id: string): string {
  return encodeURIComponent(id);
}

/** Extract an id from either a raw id string or a populated reference object. */
export function refId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '_id' in value) return String((value as Doc)._id);
  return undefined;
}

export const DATE_HINT =
  'ISO 8601; include a UTC offset for times (e.g. 2026-07-15T14:00:00+02:00) — ' +
  'call get_current_datetime for the user timezone.';

/** Upper bound on rich-text content accepted by write tools / returned by read tools. */
export const MAX_CONTENT_CHARS = 100_000;

/** Truncate very large content so a huge (possibly planted) note can't flood the LLM context. */
export function capContent(markdown: string): string {
  if (markdown.length <= MAX_CONTENT_CHARS) return markdown;
  return `${markdown.slice(0, MAX_CONTENT_CHARS)}\n\n[truncated: content exceeds ${MAX_CONTENT_CHARS} characters]`;
}

/** Fetch an activity's description note (isDescription) and return it as markdown. */
export async function fetchDescriptionMarkdown(
  ctx: AppContext,
  activityId: string,
): Promise<string | undefined> {
  const res = await ctx.client.request<ListResponse<Doc>>('/v1/notes', {
    query: buildListQuery({ filter: { activity: activityId, isDescription: true }, limit: 1 }),
  });
  const note = res.data?.[0];
  return note ? capContent(tipTapJsonToMarkdown(String(note.content ?? ''))) : undefined;
}

export function paginationHeader(ctx: AppContext, label: string, res: ListResponse<Doc>): string {
  const p = res.pagination;
  const shown = res.data?.length ?? 0;
  if (!p) return `${ctx.session.workspaceHeader()} — ${shown} ${label}`;
  const pages = p.pages ?? Math.max(1, Math.ceil(p.total / p.limit));
  return `${ctx.session.workspaceHeader()} — ${p.total} ${label} (page ${p.page}/${pages}, showing ${shown})`;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};
export const UPDATE: ToolAnnotations = { ...WRITE, idempotentHint: true };
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(header: string | undefined, data: unknown): CallToolResult {
  const body = JSON.stringify(data, null, 2);
  return textResult(header ? `${header}\n${body}` : body);
}

export function describeError(error: unknown): string {
  if (error instanceof AuthRequiredError) return error.message;
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Authentication failed. Run: npx -y @fokus-app/mcp login';
      case 403:
        return `Permission denied: ${error.message}. The resource may belong to a different workspace — check list_workspaces / set_active_workspace.`;
      case 404:
        return `Not found: ${error.message}. Check that the id is correct.`;
      case 429:
        return 'Rate limited by the Fokus API — wait a moment and retry.';
      default:
        return `Fokus API error (HTTP ${error.status}): ${error.message}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorResult(error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: describeError(error) }], isError: true };
}

/** Wrap a tool handler so every failure becomes a friendly isError result. */
export async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error);
  }
}
