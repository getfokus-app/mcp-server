import { TipTapMark, TipTapNode } from './tiptap-types.js';

/** Bail out of runaway nesting rather than overflow the stack on hostile stored content. */
const MAX_DEPTH = 100;

/**
 * Convert stored note content (stringified TipTap JSON) to markdown.
 *
 * Never throws: non-JSON content is returned as-is (the web editor applies the
 * same plain-text fallback), and web-only nodes degrade gracefully — underline
 * to plain text, highlight to ==text==, details to a bold summary line,
 * mentions to @label, mermaid to a fenced block, drawings to a placeholder.
 * Nesting beyond MAX_DEPTH is truncated so a maliciously deep doc can't overflow
 * the stack.
 */
export function tipTapJsonToMarkdown(content: string): string {
  if (!content) return '';
  let doc: TipTapNode;
  try {
    doc = JSON.parse(content) as TipTapNode;
  } catch {
    return content;
  }
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return content;
  return renderBlocks(doc.content ?? [], 0)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderBlocks(nodes: TipTapNode[], depth: number): string {
  if (depth > MAX_DEPTH) return '[truncated: content too deeply nested]';
  return nodes
    .map((node) => renderBlock(node, depth))
    .filter(Boolean)
    .join('\n\n');
}

function renderBlock(node: TipTapNode, depth: number): string {
  switch (node.type) {
    case 'paragraph':
      return renderInline(node.content, depth);
    case 'heading': {
      const level = clampLevel(node.attrs?.level);
      return `${'#'.repeat(level)} ${renderInline(node.content, depth)}`;
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return fence(plainText(node), language);
    }
    case 'mermaidDiagram': {
      const code = typeof node.attrs?.code === 'string' ? node.attrs.code : plainText(node);
      return code ? fence(code, 'mermaid') : '[unsupported: diagram]';
    }
    case 'blockquote':
      return renderBlocks(node.content ?? [], depth + 1)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'bulletList':
      return renderListItems(node.content ?? [], () => '- ', depth);
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
      return renderListItems(node.content ?? [], (i) => `${start + i}. `, depth);
    }
    case 'taskList':
      return renderListItems(
        node.content ?? [],
        (_, item) => (item.attrs?.checked === true ? '- [x] ' : '- [ ] '),
        depth,
      );
    case 'horizontalRule':
      return '---';
    case 'table':
      return renderTable(node, depth);
    case 'image':
      return renderImage(node);
    case 'details': {
      const summary = node.content?.find((c) => c.type === 'detailsSummary');
      const body = node.content?.find((c) => c.type === 'detailsContent');
      const parts: string[] = [];
      if (summary) parts.push(`**${renderInline(summary.content, depth)}**`);
      if (body) parts.push(renderBlocks(body.content ?? [], depth + 1));
      return parts.join('\n\n');
    }
    case 'excalidrawEmbed':
      return '[unsupported: drawing]';
    default: {
      // unknown block: render children if any, else its text, else a placeholder
      if (node.content?.length) return renderBlocks(node.content, depth + 1);
      if (node.text) return node.text;
      return `[unsupported: ${node.type}]`;
    }
  }
}

function renderListItems(
  items: TipTapNode[],
  prefix: (index: number, item: TipTapNode) => string,
  depth: number,
): string {
  return items
    .map((item, i) => {
      const marker = prefix(i, item);
      const body = renderBlocks(item.content ?? [], depth + 1);
      const lines = body.split('\n');
      const indent = ' '.repeat(marker.length);
      return lines
        .map((line, lineIndex) => (lineIndex === 0 ? `${marker}${line}` : `${indent}${line}`))
        .join('\n');
    })
    .join('\n');
}

function renderTable(node: TipTapNode, depth: number): string {
  const rows = (node.content ?? []).filter((row) => row.type === 'tableRow');
  if (rows.length === 0) return '';
  const cells = (row: TipTapNode) =>
    (row.content ?? []).map((cell) =>
      renderBlocks(cell.content ?? [], depth + 1).replace(/\n/g, ' '),
    );
  const header = cells(rows[0]!);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${cells(row).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function renderImage(node: TipTapNode): string {
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
  return src ? `![${alt}](${src})` : '';
}

function renderInline(nodes: TipTapNode[] | undefined, depth: number): string {
  if (!nodes || depth > MAX_DEPTH) return '';
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return applyMarks(node.text ?? '', node.marks);
        case 'hardBreak':
          return '\n';
        case 'image':
          return renderImage(node);
        case 'mention': {
          const label = node.attrs?.label ?? node.attrs?.id ?? 'mention';
          return `@${String(label)}`;
        }
        case 'math': {
          const latex = node.attrs?.latex ?? plainText(node);
          return latex ? `$${String(latex)}$` : '';
        }
        default:
          if (node.content?.length) return renderInline(node.content, depth + 1);
          return node.text ?? '';
      }
    })
    .join('');
}

function applyMarks(text: string, marks: TipTapMark[] | undefined): string {
  if (!marks || text === '') return text;
  let out = text;
  let href: string | undefined;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `*${out}*`;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'code':
        out = `\`${out}\``;
        break;
      case 'highlight':
        out = `==${out}==`;
        break;
      case 'link':
        href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined;
        break;
      default:
        // underline, textStyle, color, superscript, subscript... — keep plain text
        break;
    }
  }
  return href ? `[${out}](${href})` : out;
}

function plainText(node: TipTapNode, depth = 0): string {
  if (node.text) return node.text;
  if (depth > MAX_DEPTH) return '';
  return (node.content ?? []).map((child) => plainText(child, depth + 1)).join('');
}

function fence(code: string, language: string): string {
  return `\`\`\`${language ?? ''}\n${code}\n\`\`\``;
}

function clampLevel(level: unknown): number {
  const n = typeof level === 'number' ? level : 1;
  return Math.min(Math.max(Math.trunc(n), 1), 6);
}
