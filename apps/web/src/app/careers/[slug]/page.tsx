import { EMPLOYMENT_TYPE_LABELS, type JobDetail } from '@havenhub/shared';
import { Alert, Container } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { ApplyForm } from '@/components/cms/apply-form';
import { JsonLd } from '@/components/cms/json-ld';
import { Markdown } from '@/components/cms/markdown';
import { cmsData, getSite } from '@/lib/cms';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';

const getJob = cache(async (slug: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? cmsData<JobDetail>(`/careers/jobs/${slug}`) : null,
);

const SCHEMA_TYPE: Record<JobDetail['employmentType'], string> = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACTOR',
  INTERNSHIP: 'INTERN',
  TEMPORARY: 'TEMPORARY',
};

export async function generateMetadata({
  params,
}: PageProps<'/careers/[slug]'>): Promise<Metadata> {
  const job = await getJob((await params).slug);
  if (!job) return { title: 'Job not found', robots: { index: false } };
  return {
    title: job.seoTitle ?? `${job.title} · Careers`,
    description:
      job.seoDescription ??
      `${EMPLOYMENT_TYPE_LABELS[job.employmentType]} role in ${job.location}.`,
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/careers/${job.slug}` },
    ...(job.acceptingApplications ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function JobPage({ params }: PageProps<'/careers/[slug]'>) {
  const site = await getSite();
  const job = await getJob((await params).slug);
  if (!site.features.careers || !job) notFound();
  return (
    <Container className="py-8 lg:py-12">
      {job.acceptingApplications && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'JobPosting',
            title: job.title,
            description: job.description,
            datePosted: job.publishedAt,
            ...(job.closesAt ? { validThrough: job.closesAt } : {}),
            employmentType: SCHEMA_TYPE[job.employmentType],
            hiringOrganization: { '@type': 'Organization', name: site.siteName },
            jobLocation: {
              '@type': 'Place',
              address: {
                '@type': 'PostalAddress',
                addressLocality: job.location,
                addressCountry: 'NG',
              },
            },
          }}
        />
      )}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
        <Link href="/careers" className="hover:text-text">
          Careers
        </Link>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <article className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight break-words text-text sm:text-3xl">
            {job.title}
          </h1>
          <p className="mt-2 text-text-secondary">
            {[job.department, job.location, EMPLOYMENT_TYPE_LABELS[job.employmentType]]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {job.closesAt && (
            <p className="mt-1 text-sm text-text-muted">
              Applications close {formatDate(job.closesAt)}
            </p>
          )}
          <Markdown source={job.description} mediaBase={site.mediaBase} className="mt-8" />
          {job.requirements.trim() && (
            <section className="mt-10">
              <h2 className="text-xl font-bold tracking-tight text-text">Requirements</h2>
              <Markdown source={job.requirements} mediaBase={site.mediaBase} className="mt-4" />
            </section>
          )}
        </article>
        <aside className="lg:sticky lg:top-26 lg:self-start">
          <div className="rounded-card border border-border bg-surface p-6 shadow-card">
            <h2 className="mb-5 text-lg font-semibold text-text">Apply for this role</h2>
            {job.acceptingApplications ? (
              <ApplyForm slug={job.slug} />
            ) : (
              <Alert>This role is no longer accepting applications.</Alert>
            )}
          </div>
        </aside>
      </div>
    </Container>
  );
}
