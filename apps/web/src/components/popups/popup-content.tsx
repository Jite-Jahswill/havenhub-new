'use client';

import { type PricingPeriod, type PublicPopupView } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import { Check, Copy, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Photo } from '@/components/properties/photo';
import { discountedKobo, formatPrice } from '@/lib/format';

const EYEBROW: Record<PublicPopupView['kind'], string | null> = {
  ANNOUNCEMENT: null,
  WHATS_NEW: 'What’s new',
  OFFER: 'Special offer',
  PROPERTY: 'Featured',
};

type Content = Pick<
  PublicPopupView,
  'kind' | 'title' | 'body' | 'image' | 'property' | 'discountCode' | 'ctaLabel' | 'ctaLink'
>;

/** The inside of a pop-up; shared by the live modal and the admin preview. */
export function PopupContent({
  popup,
  titleId,
  onAction,
}: {
  popup: Content;
  titleId?: string;
  /** Called before following the button or the property link. */
  onAction?: () => void;
}) {
  const property = popup.property;
  const image = popup.image?.url ?? property?.imageUrl ?? null;
  const eyebrow = EYEBROW[popup.kind];
  const ctaHref = popup.ctaLink ?? (property ? `/properties/${property.slug}` : null);
  const ctaLabel = popup.ctaLabel ?? (property ? 'View property' : null);
  const discounted =
    property?.priceKobo != null
      ? discountedKobo(property.priceKobo, property.discountPercent)
      : null;

  return (
    <div className="flex flex-col">
      {image && (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface-secondary">
          <Photo
            src={image}
            alt={popup.image?.altText ?? ''}
            sizes="(max-width: 640px) 92vw, 480px"
          />
        </div>
      )}
      <div className="flex flex-col gap-3 p-6">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
        )}
        <h2 id={titleId} className="text-xl font-bold text-text">
          {popup.title}
        </h2>
        {property && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium text-text">{property.title}</p>
            {(property.city || property.state) && (
              <p className="flex items-center gap-1 text-text-secondary">
                <MapPin aria-hidden className="size-3.5" />
                {[property.city, property.state].filter(Boolean).join(', ')}
              </p>
            )}
            {property.priceKobo != null && (
              <p className="text-text">
                <span className="font-semibold">
                  {formatPrice(
                    discounted ?? property.priceKobo,
                    property.pricingPeriod as PricingPeriod,
                  )}
                </span>
                {discounted !== null && (
                  <>
                    {' '}
                    <s className="text-text-muted">{formatPrice(property.priceKobo)}</s>{' '}
                    <Badge tone="success">{property.discountPercent}% off</Badge>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {popup.body && (
          <p className="text-sm whitespace-pre-line text-text-secondary">{popup.body}</p>
        )}
        {popup.discountCode && <CopyCode code={popup.discountCode} />}
        {ctaHref && ctaLabel && (
          <Link
            href={ctaHref}
            onClick={onAction}
            className={buttonClasses({ className: 'mt-1 w-full' })}
          >
            {ctaLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-control border border-dashed border-primary/60 bg-primary-subtle px-4 py-3">
      <span className="font-mono text-lg font-bold tracking-wider text-primary-text">{code}</span>
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-medium text-primary-text"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => setCopied(true));
        }}
      >
        {copied ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        {copied ? 'Copied' : 'Copy code'}
      </button>
    </div>
  );
}
