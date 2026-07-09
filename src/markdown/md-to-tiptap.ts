import { Lexer, type Token, type Tokens } from 'marked';

import { TipTapMark, TipTapNode, linkMark, textNode } from './tiptap-types.js';

/**
 * Convert GitHub-flavored markdown into the stringified TipTap JSON the Fokus
 * web editor stores. Emits only nodes the web editor's extension set renders:
 * paragraph, heading, bullet/ordered/task lists, codeBlock, blockquote,
 * horizontalRule, hardBreak, table, image, and bold/italic/strike/code/link marks.
 */
export function markdownToTipTapJson(markdown: string): string {
  return JSON.stringify(markdownToTipTapDoc(markdown));
}

export function markdownToTipTapDoc(markdown: string): TipTapNode {
  const tokens = new Lexer({ gfm: true }).lex(markdown ?? '');
  const content = blocks(tokens);
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

function blocks(tokens: Token[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const t = token as Tokens.Heading;
        out.push({
          type: 'heading',
          attrs: { level: Math.min(Math.max(t.depth, 1), 6) },
          content: inline(t.tokens),
        });
        break;
      }
      case 'paragraph': {
        out.push(paragraph(inline((token as Tokens.Paragraph).tokens)));
        break;
      }
      case 'text': {
        // top-level text appears inside tight list items
        const t = token as Tokens.Text;
        out.push(paragraph(t.tokens ? inline(t.tokens) : [textNode(t.text)]));
        break;
      }
      case 'code': {
        const t = token as Tokens.Code;
        out.push({
          type: 'codeBlock',
          attrs: { language: t.lang || null },
          content: t.text ? [textNode(t.text)] : [],
        });
        break;
      }
      case 'blockquote': {
        out.push({ type: 'blockquote', content: blocks((token as Tokens.Blockquote).tokens) });
        break;
      }
      case 'list': {
        out.push(list(token as Tokens.List));
        break;
      }
      case 'table': {
        out.push(table(token as Tokens.Table));
        break;
      }
      case 'hr': {
        out.push({ type: 'horizontalRule' });
        break;
      }
      case 'html': {
        const raw = (token as Tokens.HTML).raw.trim();
        if (raw) out.push(paragraph([textNode(raw)]));
        break;
      }
      case 'space':
      case 'def':
      // checkbox state already lives on the list item's `checked` flag
      case 'checkbox':
        break;
      default: {
        // unknown block token — keep its text so content is never lost
        const raw = 'raw' in token ? String(token.raw).trim() : '';
        if (raw) out.push(paragraph([textNode(raw)]));
      }
    }
  }
  return out;
}

function paragraph(content: TipTapNode[]): TipTapNode {
  const node: TipTapNode = { type: 'paragraph' };
  if (content.length > 0) node.content = content;
  return node;
}

function list(token: Tokens.List): TipTapNode {
  const isTaskList = token.items.some((item) => item.task);
  if (isTaskList) {
    return {
      type: 'taskList',
      content: token.items.map((item) => ({
        type: 'taskItem',
        attrs: { checked: item.checked === true },
        content: listItemBlocks(item),
      })),
    };
  }
  const node: TipTapNode = {
    type: token.ordered ? 'orderedList' : 'bulletList',
    content: token.items.map((item) => ({ type: 'listItem', content: listItemBlocks(item) })),
  };
  if (token.ordered && typeof token.start === 'number' && token.start !== 1) {
    node.attrs = { start: token.start };
  }
  return node;
}

function listItemBlocks(item: Tokens.ListItem): TipTapNode[] {
  const content = blocks(item.tokens);
  // list items must contain at least one block
  return content.length > 0 ? content : [{ type: 'paragraph' }];
}

function table(token: Tokens.Table): TipTapNode {
  const headerRow: TipTapNode = {
    type: 'tableRow',
    content: token.header.map((cell) => tableCell('tableHeader', cell.tokens)),
  };
  const bodyRows = token.rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cell) => tableCell('tableCell', cell.tokens)),
  }));
  return { type: 'table', content: [headerRow, ...bodyRows] };
}

function tableCell(type: 'tableHeader' | 'tableCell', tokens: Token[]): TipTapNode {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1 },
    content: [paragraph(inline(tokens))],
  };
}

function inline(tokens: Token[] | undefined, marks: TipTapMark[] = []): TipTapNode[] {
  if (!tokens) return [];
  const out: TipTapNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) out.push(...inline(t.tokens, marks));
        else if (t.text) out.push(textNode(t.text, marks.slice()));
        break;
      }
      case 'escape': {
        out.push(textNode((token as Tokens.Escape).text, marks.slice()));
        break;
      }
      case 'strong': {
        out.push(...inline((token as Tokens.Strong).tokens, [...marks, { type: 'bold' }]));
        break;
      }
      case 'em': {
        out.push(...inline((token as Tokens.Em).tokens, [...marks, { type: 'italic' }]));
        break;
      }
      case 'del': {
        out.push(...inline((token as Tokens.Del).tokens, [...marks, { type: 'strike' }]));
        break;
      }
      case 'codespan': {
        out.push(textNode((token as Tokens.Codespan).text, [...marks, { type: 'code' }]));
        break;
      }
      case 'link': {
        const t = token as Tokens.Link;
        out.push(...inline(t.tokens, [...marks, linkMark(t.href)]));
        break;
      }
      case 'image': {
        const t = token as Tokens.Image;
        out.push({
          type: 'image',
          attrs: { src: t.href, alt: t.text || null, title: t.title || null },
        });
        break;
      }
      case 'br': {
        out.push({ type: 'hardBreak' });
        break;
      }
      case 'html': {
        const raw = (token as Tokens.HTML).raw;
        if (raw) out.push(textNode(raw, marks.slice()));
        break;
      }
      default: {
        const raw = 'raw' in token ? String(token.raw) : '';
        if (raw) out.push(textNode(raw, marks.slice()));
      }
    }
  }
  return out;
}
