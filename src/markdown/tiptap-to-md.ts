import { TipTapMark, TipTapNode } from './tiptap-types.js';

/**
 * Convert stored note content (stringified TipTap JSON) to markdown.
 *
 * Never throws: non-JSON content is returned as-is (the web editor applies the
 * same plain-text fallback), and web-only nodes degrade gracefully — underline
 * to plain text, highlight to ==text==, details to a bold summary line,
 * mentions to @label, mermaid to a fenced block, drawings to a placeholder.
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
  return renderBlocks(doc.content ?? [])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderBlocks(nodes: TipTapNode[]): string {
  return nodes
    .map((node) => renderBlock(node))
    .filter(Boolean)
    .join('\n\n');
}

function renderBlock(node: TipTapNode): string {
  switch (node.type) {
    case 'paragraph':
      return renderInline(node.content);
    case 'heading': {
      const level = clampLevel(node.attrs?.level);
      return `${'#'.repeat(level)} ${renderInline(node.content)}`;
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
      return renderBlocks(node.content ?? [])
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'bulletList':
      return renderListItems(node.content ?? [], () => '- ');
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
      return renderListItems(node.content ?? [], (i) => `${start + i}. `);
    }
    case 'taskList':
      return renderListItems(node.content ?? [], (_, item) =>
        item.attrs?.checked === true ? '- [x] ' : '- [ ] ',
      );
    case 'horizontalRule':
      return '---';
    case 'table':
      return renderTable(node);
    case 'image':
      return renderImage(node);
    case 'details': {
      const summary = node.content?.find((c) => c.type === 'detailsSummary');
      const body = node.content?.find((c) => c.type === 'detailsContent');
      const parts: string[] = [];
      if (summary) parts.push(`**${renderInline(summary.content)}**`);
      if (body) parts.push(renderBlocks(body.content ?? []));
      return parts.join('\n\n');
    }
    case 'excalidrawEmbed':
      return '[unsupported: drawing]';
    default: {
      // unknown block: render children if any, else its text, else a placeholder
      if (node.content?.length) return renderBlocks(node.content);
      if (node.text) return node.text;
      return `[unsupported: ${node.type}]`;
    }
  }
}

function renderListItems(
  items: TipTapNode[],
  prefix: (index: number, item: TipTapNode) => string,
): string {
  return items
    .map((item, i) => {
      const marker = prefix(i, item);
      const body = renderBlocks(item.content ?? []);
      const lines = body.split('\n');
      const indent = ' '.repeat(marker.length);
      return lines
        .map((line, lineIndex) => (lineIndex === 0 ? `${marker}${line}` : `${indent}${line}`))
        .join('\n');
    })
    .join('\n');
}

function renderTable(node: TipTapNode): string {
  const rows = (node.content ?? []).filter((row) => row.type === 'tableRow');
  if (rows.length === 0) return '';
  const cells = (row: TipTapNode) =>
    (row.content ?? []).map((cell) => renderBlocks(cell.content ?? []).replace(/\n/g, ' '));
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

function renderInline(nodes: TipTapNode[] | undefined): string {
  if (!nodes) return '';
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
          if (node.content?.length) return renderInline(node.content);
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

function plainText(node: TipTapNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(plainText).join('');
}

function fence(code: string, language: string): string {
  return `\`\`\`${language ?? ''}\n${code}\n\`\`\``;
}

function clampLevel(level: unknown): number {
  const n = typeof level === 'number' ? level : 1;
  return Math.min(Math.max(Math.trunc(n), 1), 6);
}
