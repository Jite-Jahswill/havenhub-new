import { isExternalHref, parseMarkdown, type MdBlock, type MdInline } from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import type { ReactNode } from 'react';

/**
 * Renders CMS Markdown through the shared safe parser: only allow-listed
 * elements, validated links and HavenHub CMS images — never raw HTML and
 * never dangerouslySetInnerHTML. Used for public pages and admin previews.
 */
export function Markdown({
  source,
  mediaBase,
  className,
}: {
  source: string;
  mediaBase: string;
  className?: string;
}) {
  const nodes = parseMarkdown(source, { mediaBase });
  return <div className={cn('cms-prose', className)}>{nodes.map((n, i) => block(n, i))}</div>;
}

const HEADINGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

function block(node: MdBlock, key: number): ReactNode {
  switch (node.t) {
    case 'h': {
      const Tag = HEADINGS[node.level];
      return <Tag key={key}>{inlines(node.c)}</Tag>;
    }
    case 'p':
      return <p key={key}>{inlines(node.c)}</p>;
    case 'ul':
      return (
        <ul key={key}>
          {node.items.map((item, i) => (
            <li key={i}>{item.map((b, j) => block(b, j))}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} start={node.start}>
          {node.items.map((item, i) => (
            <li key={i}>{item.map((b, j) => block(b, j))}</li>
          ))}
        </ol>
      );
    case 'quote':
      return <blockquote key={key}>{node.c.map((b, i) => block(b, i))}</blockquote>;
    case 'pre':
      return (
        <pre key={key}>
          <code>{node.v}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} />;
    case 'table':
      return (
        <div key={key} className="cms-table">
          <table>
            <thead>
              <tr>
                {node.head.map((c, i) => (
                  <th key={i} scope="col">
                    {inlines(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>{inlines(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function inlines(nodes: MdInline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v;
      case 'strong':
        return <strong key={i}>{inlines(n.c)}</strong>;
      case 'em':
        return <em key={i}>{inlines(n.c)}</em>;
      case 'del':
        return <del key={i}>{inlines(n.c)}</del>;
      case 'code':
        return <code key={i}>{n.v}</code>;
      case 'br':
        return <br key={i} />;
      case 'link':
        return isExternalHref(n.href) ? (
          <a
            key={i}
            href={n.href}
            title={n.title}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {inlines(n.c)}
          </a>
        ) : (
          <a key={i} href={n.href} title={n.title}>
            {inlines(n.c)}
          </a>
        );
      case 'img':
        // eslint-disable-next-line @next/next/no-img-element -- re-encoded CMS media, any size
        return <img key={i} src={n.src} alt={n.alt} loading="lazy" decoding="async" />;
    }
  });
}
