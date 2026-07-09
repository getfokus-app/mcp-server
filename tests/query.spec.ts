import { describe, expect, it } from 'vitest';

import { buildListQuery, containsRegex, dateRange, escapeRegex } from '../src/api/query.js';

describe('buildListQuery', () => {
  it('serializes filter as JSON with sort/page/limit', () => {
    const qs = buildListQuery({
      filter: { isCompleted: false, doDate: { $gte: '2026-07-01' } },
      sort: '-createdAt',
      page: 2,
      limit: 20,
    });
    const params = new URLSearchParams(qs);
    expect(JSON.parse(params.get('filter')!)).toEqual({
      isCompleted: false,
      doDate: { $gte: '2026-07-01' },
    });
    expect(params.get('sort')).toBe('-createdAt');
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('20');
  });

  it('omits empty filter', () => {
    expect(buildListQuery({ filter: {}, limit: 5 })).toBe('limit=5');
  });
});

describe('escapeRegex / containsRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c(d)')).toBe('a\\.b\\*c\\(d\\)');
  });

  it('builds a case-insensitive contains filter', () => {
    expect(containsRegex('Foo')).toEqual({ $regex: 'Foo', $options: 'i' });
  });
});

describe('dateRange', () => {
  it('builds $gte/$lte bounds', () => {
    expect(dateRange('2026-01-01', '2026-01-31')).toEqual({
      $gte: '2026-01-01',
      $lte: '2026-01-31',
    });
    expect(dateRange('2026-01-01', undefined)).toEqual({ $gte: '2026-01-01' });
    expect(dateRange(undefined, undefined)).toBeUndefined();
  });
});
