import { EMPLOYMENT_TYPE_LABELS, type JobCard } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import { Briefcase, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { cmsData, getSite, routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/careers', {
    title: 'Careers',
    description: 'Open roles at HavenHub.',
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/careers` },
  });
}

export default async function CareersPage() {
  const site = await getSite();
  if (!site.features.careers) notFound();
  const jobs = (await cmsData<JobCard[]>('/careers/jobs')) ?? [];
  return (
    <Container className="py-8 lg:py-12">
      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">Careers</h1>
        <p className="mt-2 text-text-secondary">
          Help build Nigeria’s home for places and experiences.
        </p>
      </header>
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-20 text-center">
          <Briefcase aria-hidden className="size-8 text-text-muted" strokeWidth={1.5} />
          <h2 className="mt-4 font-semibold text-text">No open roles right now</h2>
          <p className="mt-1 text-sm text-text-secondary">Please check back later.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/careers/${j.slug}`}
                className="flex flex-col gap-1 px-5 py-4 hover:bg-surface-secondary sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block font-semibold break-words text-text">{j.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
                    <span className="flex items-center gap-1">
                      <MapPin aria-hidden className="size-3.5" /> {j.location}
                    </span>
                    {j.department && <span>{j.department}</span>}
                  </span>
                </span>
                <span className="text-sm font-medium text-text">
                  {EMPLOYMENT_TYPE_LABELS[j.employmentType]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
