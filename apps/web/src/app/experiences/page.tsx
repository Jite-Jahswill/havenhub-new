import { Container } from '@havenhub/ui';
import { BedDouble, Map, Palmtree, Sparkles, Ticket, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Experiences',
  description: 'Events, tours, hotels, cleaning services and holiday destinations across Nigeria.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/experiences` },
};

const SECTIONS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  { href: '/events', title: 'Events', text: 'Concerts, festivals and gatherings.', icon: Ticket },
  { href: '/tours', title: 'Tours', text: 'City walks, zoo trips and adventures.', icon: Map },
  {
    href: '/hotels',
    title: 'Hotels',
    text: 'Rooms, nightly prices and availability.',
    icon: BedDouble,
  },
  {
    href: '/cleaning',
    title: 'Cleaning',
    text: 'Verified home and office cleaners.',
    icon: Sparkles,
  },
  { href: '/destinations', title: 'Destinations', text: 'Where to go on holiday.', icon: Palmtree },
];

export default function ExperiencesPage() {
  return (
    <Container className="py-8 lg:py-12">
      <header className="mb-10 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">Experiences</h1>
        <p className="mt-2 text-text-secondary">
          More than a place to stay: discover what’s on, where to go and who can help.
        </p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, title, text, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex h-full items-start gap-4 rounded-card border border-border bg-surface p-6 shadow-card transition-colors hover:bg-surface-secondary"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary-text">
                <Icon aria-hidden className="size-5" />
              </span>
              <span>
                <span className="block font-semibold text-text">{title}</span>
                <span className="mt-1 block text-sm text-text-secondary">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
