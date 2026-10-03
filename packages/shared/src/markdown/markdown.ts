import { Lexer, type Token, type Tokens } from 'marked';

import { isCmsImageSrc, isSafeHref } from './safe-url.js';

/**
 * Safe Markdown for CMS content. Markdown source is parsed (by `marked`'s
 * lexer only — never its HTML renderer) into a small tree of allow-listed
 * nodes. Raw HTML is dropped, links must pass `isSafeHref`, and images must
 * be HavenHub CMS media. Every renderer (web React, admin preview, campaign
 * email) consumes this tree, so the security boundary lives in one place.
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: MdInline[] }
  | { t: 'code'; v: string }
  | { t: 'br' }
  | { t: 'link'; href: string; title?: string; c: MdInline[] }
  | { t: 'img'; src: string; alt: string };

export type MdBlock =
  | { t: 'h'; level: 2 | 3 | 4; c: MdInline[] }
  | { t: 'p'; c: MdInline[] }
  | { t: 'ul' | 'ol'; start?: number; items: MdBlock[][] }
  | { t: 'quote'; c: MdBlock[] }
  | { t: 'pre'; v: string }
  | { t: 'hr' }
  | { t: 'table'; head: MdInline[][]; rows: MdInline[][][] };

export interface MarkdownOptions {
  /** Public media base URL ("/api/media" or a CDN origin). */
  mediaBase: string;
}

const MAX_DEPTH = 8;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 200;

export function parseMarkdown(source: string, options: MarkdownOptions): MdBlock[] {
  const tokens = new Lexer({ gfm: true, breaks: false }).lex(source ?? '');
  return blocks(tokens, options, 0);
}

function blocks(tokens: Token[], o: MarkdownOptions, depth: number): MdBlock[] {
  if (depth > MAX_DEPTH) return [];
  const out: MdBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const level = Math.min(Math.max((token as Tokens.Heading).depth, 2), 4) as 2 | 3 | 4;
        out.push({ t: 'h', level, c: inlines(token.tokens ?? [], o, depth) });
        break;
      }
      case 'paragraph':
      case 'text': {
        const c = inlines(
          token.tokens ?? [{ type: 'text', raw: token.raw, text: (token as Tokens.Text).text }],
          o,
          depth,
        );
        if (c.length) out.push({ t: 'p', c });
        break;
      }
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.slice(0, 500).map((item) => blocks(item.tokens, o, depth + 1));
        const start = typeof list.start === 'number' && list.start > 1 ? list.start : undefined;
        out.push(
          list.ordered ? { t: 'ol', ...(start ? { start } : {}), items } : { t: 'ul', items },
        );
        break;
      }
      case 'blockquote':
        out.push({ t: 'quote', c: blocks((token as Tokens.Blockquote).tokens, o, depth + 1) });
        break;
      case 'code':
        out.push({ t: 'pre', v: (token as Tokens.Code).text });
        break;
      case 'hr':
        out.push({ t: 'hr' });
        break;
      case 'table': {
        const table = token as Tokens.Table;
        const cell = (c: Tokens.TableCell) => inlines(c.tokens, o, depth);
        out.push({
          t: 'table',
          head: table.header.slice(0, MAX_TABLE_COLUMNS).map(cell),
          rows: table.rows
            .slice(0, MAX_TABLE_ROWS)
            .map((row) => row.slice(0, MAX_TABLE_COLUMNS).map(cell)),
        });
        break;
      }
      // 'html' (raw HTML), 'space', 'def' and anything unknown are dropped.
      default:
        break;
    }
  }
  return out;
}

function inlines(tokens: Token[], o: MarkdownOptions, depth: number): MdInline[] {
  if (depth > MAX_DEPTH) return [];
  const out: MdInline[] = [];
  const push = (node: MdInline) => {
    const last = out.at(-1);
    if (node.t === 'text' && last?.t === 'text') last.v += node.v;
    else out.push(node);
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        const nested = (token as Tokens.Text).tokens;
        if (nested?.length) for (const n of inlines(nested, o, depth + 1)) push(n);
        else push({ t: 'text', v: (token as Tokens.Text).text });
        break;
      }
      case 'strong':
      case 'em':
      case 'del':
        push({ t: token.type, c: inlines(token.tokens ?? [], o, depth + 1) });
        break;
      case 'codespan':
        push({ t: 'code', v: (token as Tokens.Codespan).text });
        break;
      case 'br':
        push({ t: 'br' });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const children = inlines(link.tokens, o, depth + 1);
        if (isSafeHref(link.href)) {
          push({
            t: 'link',
            href: link.href,
            ...(link.title ? { title: link.title } : {}),
            c: children,
          });
        } else {
          // Unsafe target: keep the words, drop the link.
          for (const n of children) push(n);
        }
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        if (isCmsImageSrc(image.href, o.mediaBase)) {
          push({ t: 'img', src: image.href, alt: image.text.slice(0, 200) });
        }
        break;
      }
      // Raw HTML ('html') and anything unknown are dropped.
      default:
        break;
    }
  }
  return out;
}

/** Every image source the source *asks* for (valid or not), for server-side checks. */
export function markdownImageSources(source: string): string[] {
  const found: string[] = [];
  const walk = (tokens: Token[] | undefined) => {
    for (const token of tokens ?? []) {
      if (token.type === 'image') found.push((token as Tokens.Image).href);
      if ('tokens' in token) walk(token.tokens);
      if (token.type === 'list') for (const item of (token as Tokens.List).items) walk(item.tokens);
      if (token.type === 'table') {
        const table = token as Tokens.Table;
        for (const c of table.header) walk(c.tokens);
        for (const row of table.rows) for (const c of row) walk(c.tokens);
      }
    }
  };
  walk(new Lexer({ gfm: true }).lex(source ?? ''));
  return found;
}

/** Plain text of a document (excerpts, email text parts, reading time). */
export function markdownToText(nodes: MdBlock[]): string {
  const inline = (c: MdInline[]): string =>
    c
      .map((n) =>
        n.t === 'text' || n.t === 'code'
          ? n.v
          : n.t === 'br'
            ? '\n'
            : n.t === 'img'
              ? n.alt
              : 'c' in n
                ? inline(n.c)
                : '',
      )
      .join('');
  const block = (b: MdBlock): string => {
    switch (b.t) {
      case 'h':
      case 'p':
        return inline(b.c);
      case 'ul':
      case 'ol':
        return b.items.map((item) => `• ${item.map(block).join(' ')}`).join('\n');
      case 'quote':
        return b.c.map(block).join('\n');
      case 'pre':
        return b.v;
      case 'hr':
        return '';
      case 'table':
        return [b.head, ...b.rows].map((r) => r.map(inline).join(' | ')).join('\n');
    }
  };
  return nodes.map(block).filter(Boolean).join('\n\n');
}

/** Minutes to read at ~200 words per minute (at least 1). */
export function readingMinutes(nodes: MdBlock[]): number {
  const words = markdownToText(nodes).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/**
 * HTML for emails, built only from the safe tree with every string escaped.
 * Relative links and images are made absolute against `siteUrl`.
 */
export function markdownToEmailHtml(nodes: MdBlock[], siteUrl: string): string {
  const abs = (url: string) => (url.startsWith('/') ? `${siteUrl.replace(/\/+$/, '')}${url}` : url);
  const inline = (c: MdInline[]): string =>
    c
      .map((n) => {
        switch (n.t) {
          case 'text':
            return esc(n.v);
          case 'strong':
            return `<strong>${inline(n.c)}</strong>`;
          case 'em':
            return `<em>${inline(n.c)}</em>`;
          case 'del':
            return `<del>${inline(n.c)}</del>`;
          case 'code':
            return `<code>${esc(n.v)}</code>`;
          case 'br':
            return '<br>';
          case 'link':
            return `<a href="${esc(abs(n.href))}">${inline(n.c)}</a>`;
          case 'img':
            return `<img src="${esc(abs(n.src))}" alt="${esc(n.alt)}" style="max-width:100%;height:auto">`;
        }
      })
      .join('');
  const block = (b: MdBlock): string => {
    switch (b.t) {
      case 'h':
        return `<h${b.level}>${inline(b.c)}</h${b.level}>`;
      case 'p':
        return `<p>${inline(b.c)}</p>`;
      case 'ul':
        return `<ul>${b.items.map((i) => `<li>${i.map(block).join('')}</li>`).join('')}</ul>`;
      case 'ol':
        return `<ol${b.start ? ` start="${b.start}"` : ''}>${b.items.map((i) => `<li>${i.map(block).join('')}</li>`).join('')}</ol>`;
      case 'quote':
        return `<blockquote>${b.c.map(block).join('')}</blockquote>`;
      case 'pre':
        return `<pre>${esc(b.v)}</pre>`;
      case 'hr':
        return '<hr>';
      case 'table':
        return `<table><thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;
    }
  };
  return nodes.map(block).join('\n');
}
