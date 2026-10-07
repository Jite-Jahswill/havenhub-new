import type { HomepageSectionView } from '@havenhub/shared';
import { Container, buttonClasses, cn } from '@havenhub/ui';
import { Search } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

type Hero = Extract<HomepageSectionView, { key: 'HERO' }>;

/** How dark the overlay is behind the text on a background image. */
const OVERLAY: Record<Hero['overlay'], string> = {
  LIGHT: 'bg-black/30',
  MEDIUM: 'bg-black/50',
  STRONG: 'bg-black/70',
};

/**
 * The homepage hero: text only, text over a full-width background image, or
 * text beside an image. The image is the page's largest element, so it is
 * loaded with priority.
 */
export function HeroSection({ section, headingLevel }: { section: Hero; headingLevel: 1 | 2 }) {
  const image = section.image;
  const onImage = Boolean(image) && section.imageLayout === 'BACKGROUND';
  const side = Boolean(image) && section.imageLayout === 'SIDE';
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  const text = (
    <div className="max-w-3xl">
      {section.eyebrow && (
        <p
          className={cn(
            'text-sm font-semibold tracking-wide uppercase',
            onImage ? 'text-white/90' : 'text-primary-text',
          )}
        >
          {section.eyebrow}
        </p>
      )}
      {section.title && (
        <Heading
          className={cn(
            'mt-5 text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-6xl',
            onImage ? 'text-white' : 'text-text',
          )}
        >
          {section.title}
        </Heading>
      )}
      {section.subtitle && (
        <p
          className={cn(
            'mt-6 max-w-2xl text-lg leading-relaxed text-pretty',
            onImage ? 'text-white/85' : 'text-text-secondary',
          )}
        >
          {section.subtitle}
        </p>
      )}
      {section.showSearch && (
        /* A plain GET form: works before JavaScript loads. */
        <form action="/properties" role="search" className="relative mt-10 max-w-xl">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-text-muted"
          />
          <input
            name="q"
            placeholder={section.searchPlaceholder ?? 'Where do you want to live or stay?'}
            aria-label="Search by area, city or street"
            className="h-14 w-full rounded-full border border-border-strong bg-surface pr-32 pl-13 text-text shadow-raised placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
          />
          <button
            type="submit"
            className={buttonClasses({
              className: 'absolute top-1/2 right-2 -translate-y-1/2 rounded-full',
            })}
          >
            Search
          </button>
        </form>
      )}
      {section.links.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          {section.links.map((link) => (
            <Link
              key={`${link.label}-${link.href}`}
              href={link.href}
              className={cn(
                'rounded-full border px-4 py-2 font-medium',
                onImage
                  ? 'border-white/50 bg-black/20 text-white hover:border-white hover:bg-black/30'
                  : 'border-border text-text-secondary hover:border-border-strong hover:text-text',
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  if (onImage) {
    return (
      <section className="relative isolate overflow-hidden py-24 sm:py-32 lg:py-40">
        <Image
          src={image!.url}
          alt={image!.altText ?? ''}
          fill
          priority
          unoptimized
          sizes="100vw"
          className="-z-20 object-cover"
        />
        <div aria-hidden className={cn('absolute inset-0 -z-10', OVERLAY[section.overlay])} />
        <Container>{text}</Container>
      </section>
    );
  }

  return (
    <section className="py-20 sm:py-28 lg:py-36">
      <Container>
        {side ? (
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
            {text}
            <div className="relative aspect-[4/3] overflow-hidden rounded-card shadow-raised">
              <Image
                src={image!.url}
                alt={image!.altText ?? ''}
                fill
                priority
                unoptimized
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
          </div>
        ) : (
          text
        )}
      </Container>
    </section>
  );
}
