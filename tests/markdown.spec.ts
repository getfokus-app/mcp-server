import { describe, expect, it } from 'vitest';

import { markdownToTipTapDoc, markdownToTipTapJson } from '../src/markdown/md-to-tiptap.js';
import { tipTapJsonToMarkdown } from '../src/markdown/tiptap-to-md.js';

describe('markdownToTipTapDoc', () => {
  it('converts headings, paragraphs, and inline marks', () => {
    const doc = markdownToTipTapDoc('# Title\n\nSome **bold** and *italic* and `code`.');
    expect(doc.type).toBe('doc');
    expect(doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    const para = doc.content?.[1];
    expect(para?.type).toBe('paragraph');
    const bold = para?.content?.find((n) => n.marks?.some((m) => m.type === 'bold'));
    expect(bold?.text).toBe('bold');
    const code = para?.content?.find((n) => n.marks?.some((m) => m.type === 'code'));
    expect(code?.text).toBe('code');
  });

  it('converts links with the web-editor attrs', () => {
    const doc = markdownToTipTapDoc('[Fokus](https://getfokus.com)');
    const textNode = doc.content?.[0]?.content?.[0];
    expect(textNode?.text).toBe('Fokus');
    expect(textNode?.marks?.[0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://getfokus.com', target: '_blank' },
    });
  });

  it('converts bullet, ordered, and nested lists', () => {
    const doc = markdownToTipTapDoc('- a\n- b\n  - b1\n\n1. one\n2. two');
    const [bullets, ordered] = doc.content ?? [];
    expect(bullets?.type).toBe('bulletList');
    expect(bullets?.content).toHaveLength(2);
    const nested = bullets?.content?.[1]?.content?.find((n) => n.type === 'bulletList');
    expect(nested).toBeDefined();
    expect(ordered?.type).toBe('orderedList');
  });

  it('converts GFM task lists to taskList/taskItem', () => {
    const doc = markdownToTipTapDoc('- [ ] open\n- [x] done');
    const list = doc.content?.[0];
    expect(list?.type).toBe('taskList');
    expect(list?.content?.[0]).toMatchObject({ type: 'taskItem', attrs: { checked: false } });
    expect(list?.content?.[1]).toMatchObject({ type: 'taskItem', attrs: { checked: true } });
  });

  it('converts fenced code blocks with language', () => {
    const doc = markdownToTipTapDoc('```ts\nconst x = 1;\n```');
    expect(doc.content?.[0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'ts' } });
    expect(doc.content?.[0]?.content?.[0]?.text).toBe('const x = 1;');
  });

  it('converts tables', () => {
    const doc = markdownToTipTapDoc('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const table = doc.content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(table?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it('converts blockquotes and horizontal rules', () => {
    const doc = markdownToTipTapDoc('> quoted\n\n---');
    expect(doc.content?.[0]?.type).toBe('blockquote');
    expect(doc.content?.[1]?.type).toBe('horizontalRule');
  });

  it('produces an empty paragraph for empty input', () => {
    expect(markdownToTipTapDoc('').content).toEqual([{ type: 'paragraph' }]);
  });

  it('drops the link mark for unsafe schemes but keeps the text', () => {
    const doc = markdownToTipTapDoc('[click](javascript:alert(1)) and [ok](https://x.com)');
    const marks = doc.content?.[0]?.content?.flatMap((n) => n.marks ?? []) ?? [];
    const hrefs = marks.filter((m) => m.type === 'link').map((m) => m.attrs?.href);
    expect(hrefs).toEqual(['https://x.com']); // javascript: link demoted to plain text
    expect(JSON.stringify(doc)).toContain('click'); // text preserved
    expect(JSON.stringify(doc)).not.toContain('javascript:');
  });

  it('keeps http/https/mailto and relative links', () => {
    for (const href of ['https://x.com', 'http://x.com', 'mailto:a@b.com', '/relative']) {
      const doc = markdownToTipTapDoc(`[t](${href})`);
      const mark = doc.content?.[0]?.content?.[0]?.marks?.find((m) => m.type === 'link');
      expect(mark?.attrs?.href, href).toBe(href);
    }
  });

  it('drops images with unsafe src, keeping alt text', () => {
    const doc = markdownToTipTapDoc('![alt](data:text/html,<script>evil</script>)');
    expect(JSON.stringify(doc)).not.toContain('data:text/html');
    expect(JSON.stringify(doc)).toContain('alt');
  });

  it('does not overflow the stack on deeply nested markdown', () => {
    const deep = '> '.repeat(5000) + 'x';
    expect(() => markdownToTipTapJson(deep)).not.toThrow();
  });
});

describe('tipTapJsonToMarkdown', () => {
  it('returns plain text content unchanged (NoteEditor fallback parity)', () => {
    expect(tipTapJsonToMarkdown('just plain text')).toBe('just plain text');
  });

  it('returns empty string for empty content', () => {
    expect(tipTapJsonToMarkdown('')).toBe('');
  });

  it('degrades web-only nodes and marks gracefully', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'highlighted', marks: [{ type: 'highlight' }] },
            { type: 'mention', attrs: { label: 'Islam' } },
          ],
        },
        { type: 'excalidrawEmbed', attrs: {} },
        { type: 'someFutureNode', attrs: {} },
      ],
    });
    const md = tipTapJsonToMarkdown(doc);
    expect(md).toContain('plain underlined and ==highlighted==@Islam');
    expect(md).toContain('[unsupported: drawing]');
    expect(md).toContain('[unsupported: someFutureNode]');
  });

  it('renders task lists with checkboxes', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'open' }] }],
            },
          ],
        },
      ],
    });
    expect(tipTapJsonToMarkdown(doc)).toBe('- [x] done\n- [ ] open');
  });

  it('never throws on malformed structures', () => {
    expect(tipTapJsonToMarkdown('{"type":"doc"')).toBe('{"type":"doc"');
    expect(tipTapJsonToMarkdown('{"type":"doc","content":[{"type":"text"}]}')).toBeDefined();
    expect(tipTapJsonToMarkdown('null')).toBe('null');
  });

  it('truncates instead of overflowing the stack on a deeply nested stored doc', () => {
    // built as a raw string so the test's own JSON.stringify doesn't overflow;
    // 500 levels comfortably exceeds the renderer's depth cap (100)
    const depth = 500;
    const doc =
      '{"type":"doc","content":[' +
      '{"type":"blockquote","content":['.repeat(depth) +
      '{"type":"paragraph","content":[{"type":"text","text":"deep"}]}' +
      ']}'.repeat(depth) +
      ']}';
    let out = '';
    expect(() => {
      out = tipTapJsonToMarkdown(doc);
    }).not.toThrow();
    expect(out).toContain('truncated');
  });
});

describe('round trip', () => {
  const SAMPLE = [
    '# Plan',
    '',
    'Intro with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://getfokus.com).',
    '',
    '- first',
    '- second',
    '',
    '1. one',
    '2. two',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    '> a quote',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '---',
    '',
    '| h1 | h2 |',
    '| --- | --- |',
    '| a | b |',
  ].join('\n');

  it('markdown → tiptap → markdown is stable', () => {
    const once = tipTapJsonToMarkdown(markdownToTipTapJson(SAMPLE));
    const twice = tipTapJsonToMarkdown(markdownToTipTapJson(once));
    expect(twice).toBe(once);
    // spot-check the salient features survive
    expect(once).toContain('# Plan');
    expect(once).toContain('**bold**');
    expect(once).toContain('[link](https://getfokus.com)');
    expect(once).toContain('- [x] done');
    expect(once).toContain('```js');
    expect(once).toContain('| h1 | h2 |');
  });
});
