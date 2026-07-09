/**
 * Builders for @fokus-app/nestjs-mongoose-fps list query strings:
 * `?filter=<urlencoded JSON>&sort=-createdAt&page=1&limit=20`
 */

export interface ListParams {
  filter?: Record<string, unknown>;
  sort?: string;
  page?: number;
  limit?: number;
}

export function buildListQuery(params: ListParams): string {
  const qs = new URLSearchParams();
  if (params.filter && Object.keys(params.filter).length > 0) {
    qs.set('filter', JSON.stringify(params.filter));
  }
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  return qs.toString();
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" filter. */
export function containsRegex(value: string): { $regex: string; $options: string } {
  return { $regex: escapeRegex(value), $options: 'i' };
}

/** Inclusive date-range filter; pass ISO 8601 strings. Returns undefined when both ends are open. */
export function dateRange(from?: string, to?: string): Record<string, string> | undefined {
  if (!from && !to) return undefined;
  const range: Record<string, string> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}

/** Drop undefined values so partial tool input maps cleanly onto filters/DTOs. */
export function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
