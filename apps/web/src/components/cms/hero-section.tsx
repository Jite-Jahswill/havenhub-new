import type { HomepageSectionView } from '@havenhub/shared';
import { Container, buttonClasses, cn } from '@havenhub/ui';
import {
  BadgeCheck,
  BedDouble,
  Building2,
  CalendarHeart,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Tent,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { AssistantPrompt } from '@/components/assistant/assistant-prompt';

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
            'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide uppercase sm:text-sm',
            onImage
              ? 'bg-white/15 text-white backdrop-blur'
              : 'bg-primary-subtle text-primary-text',
          )}
        >
          <Sparkles aria-hidden className="size-4" />
          {section.eyebrow}
        </p>
      )}
      {section.title && (
        <Heading
          className={cn(
            'isolate mt-6 text-4xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-6xl',
            onImage ? 'text-white' : 'text-text',
          )}
        >
          <Highlighted title={section.title} />
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
          <MapPin
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-primary-text"
          />
          <input
            name="q"
            placeholder={section.searchPlaceholder ?? 'Where do you want to live or stay?'}
            aria-label="Search by area, city or street"
            className="h-16 w-full rounded-full border border-border bg-surface pr-18 pl-13 text-text shadow-overlay placeholder:text-text-muted focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none sm:pr-36"
          />
          <button
            type="submit"
            className={buttonClasses({
              size: 'lg',
              className: 'absolute top-2 right-2 h-12 rounded-full px-4 sm:px-6',
            })}
          >
            <Search aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">Search</span>
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
                'rounded-full border px-4 py-2 font-medium transition-[translate,background-color,border-color,color] duration-150 hover:-translate-y-0.5',
                onImage
                  ? 'border-white/50 bg-black/20 text-white hover:border-white hover:bg-black/30'
                  : 'border-border bg-surface text-text-secondary shadow-card hover:border-primary/40 hover:text-primary-text',
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
      <AssistantPrompt onImage={onImage} />
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
    <section className="relative isolate overflow-hidden py-20 sm:py-28 lg:py-32">
      <div aria-hidden className="hh-hero-backdrop absolute inset-0 -z-10" />
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
          <div className="grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
            {text}
            <Collage />
          </div>
        )}
      </Container>
    </section>
  );
}

/** Underlines the title's last word with a hand-drawn stroke (punctuation stays outside). */
function Highlighted({ title }: { title: string }) {
  const match = /^(.*\s)(\S+?)([.!?…]*)$/u.exec(title.trim());
  if (!match) return title;
  const [, head, word, tail] = match;
  return (
    <>
      {head}
      <span className="hh-scribble">{word}</span>
      {tail}
    </>
  );
}

const TILES: { icon: LucideIcon; label: string; tone: string; className: string }[] = [
  {
    icon: BedDouble,
    label: 'Short stays',
    tone: 'bg-accent-coral-subtle text-accent-coral',
    className: 'hh-float -rotate-3',
  },
  {
    icon: Building2,
    label: 'Homes to rent',
    tone: 'bg-accent-sky-subtle text-accent-sky',
    className: 'hh-float-delay mt-10 rotate-2',
  },
  {
    icon: CalendarHeart,
    label: 'Events',
    tone: 'bg-accent-grape-subtle text-accent-grape',
    className: 'hh-float-delay rotate-2',
  },
  {
    icon: Tent,
    label: 'Tours & getaways',
    tone: 'bg-accent-leaf-subtle text-accent-leaf',
    className: 'hh-float mt-10 -rotate-2',
  },
];

/** Decorative category tiles beside a hero that has no image. Hidden from assistive tech. */
function Collage() {
  return (
    <div aria-hidden className="relative hidden select-none lg:block">
      <div className="grid grid-cols-2 gap-5">
        {TILES.map(({ icon: Icon, label, tone, className }) => (
          <div
            key={label}
            className={cn(
              'rounded-card border border-border bg-surface p-6 shadow-overlay',
              className,
            )}
          >
            <span className={cn('grid size-12 place-items-center rounded-2xl', tone)}>
              <Icon className="size-6" strokeWidth={1.8} />
            </span>
            <p className="mt-5 font-semibold text-text">{label}</p>
            <div className="mt-3 space-y-2">
              <span className="block h-2 w-4/5 rounded-full bg-surface-secondary" />
              <span className="block h-2 w-1/2 rounded-full bg-surface-secondary" />
            </div>
          </div>
        ))}
      </div>
      <div className="absolute -top-5 -left-6 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text shadow-raised">
        <BadgeCheck className="size-4 text-success" />
        Verified hosts
      </div>
      <div className="absolute -right-4 -bottom-6 flex items-center gap-2 rounded-full bg-surface-inverse px-4 py-2 text-sm font-semibold text-text-inverse shadow-raised">
        <ShieldCheck className="size-4" />
        Clear, upfront pricing
      </div>
    </div>
  );
}
