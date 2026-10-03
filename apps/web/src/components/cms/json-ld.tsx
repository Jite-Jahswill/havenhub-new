/**
 * Structured data. Serialised with `<` escaped so content can never close
 * the script element (the only HTML injected anywhere for CMS content).
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
