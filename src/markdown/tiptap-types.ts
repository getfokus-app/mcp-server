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
