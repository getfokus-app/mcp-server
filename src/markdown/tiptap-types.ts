/**
 * TipTap (ProseMirror) document JSON types, matching what the Fokus web editor
 * produces via editor.getJSON() and stores stringified in note `content`.
 */

export interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

export function textNode(value: string, marks?: TipTapMark[]): TipTapNode {
  const node: TipTapNode = { type: 'text', text: value };
  if (marks?.length) node.marks = marks;
  return node;
}

/** Link mark attrs matching the web editor / chrome extension output. */
export function linkMark(href: string): TipTapMark {
  return {
    type: 'link',
    attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
  };
}

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Accept a link/image URL only if it is scheme-relative/relative or uses a safe
 * scheme. Blocks active-content URLs (javascript:, data:, vbscript:, file:...)
 * from being persisted into stored note content — defense in depth on top of
 * the web editor's own render-time sanitization.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') return false;
  // relative or protocol-relative URLs have no scheme of their own
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  try {
    return SAFE_URL_SCHEMES.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}
