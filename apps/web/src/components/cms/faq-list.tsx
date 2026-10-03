import type { FaqView } from '@havenhub/shared';

import { Markdown } from './markdown';

/** Native disclosure widgets: keyboard and screen-reader friendly without JavaScript. */
export function FaqList({ faqs, mediaBase }: { faqs: FaqView[]; mediaBase: string }) {
  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface">
      {faqs.map((f) => (
        <details key={f.id} className="group px-5 py-4">
          <summary className="cursor-pointer list-none font-medium text-text marker:hidden focus-visible:outline-2 focus-visible:outline-primary">
            <span className="flex items-start justify-between gap-4">
              {f.question}
              <span
                aria-hidden
                className="shrink-0 text-text-muted transition-transform group-open:rotate-45"
              >
                +
              </span>
            </span>
          </summary>
          <Markdown source={f.answer} mediaBase={mediaBase} className="mt-3 text-sm" />
        </details>
      ))}
    </div>
  );
}
