'use client';

import {
  CMS_LIMITS,
  EMPLOYMENT_TYPE_LABELS,
  EmploymentType,
  type AdminJobView,
  type ApiError,
  type JobStatus,
} from '@havenhub/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  buttonClasses,
} from '@havenhub/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';

import { MarkdownEditor } from './markdown-editor';
import { SeoFields, type SeoValue } from './seo-fields';

const STATUS_TONE: Record<JobStatus, 'neutral' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  CLOSED: 'warning',
  ARCHIVED: 'neutral',
};
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Open',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{JOB_STATUS_LABEL[status]}</Badge>;
}

/** Closing date: a calendar day in Lagos, closing at the end of that day. */
const toDay = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 10) : '';
const fromDay = (day: string) => (day ? `${day}T23:59:59+01:00` : null);

export function JobEditor({
  job,
  mediaBase,
  canUpload,
}: {
  job: AdminJobView | null;
  mediaBase: string;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(job?.title ?? '');
  const [slug, setSlug] = useState(job?.slug ?? '');
  const [department, setDepartment] = useState(job?.department ?? '');
  const [location, setLocation] = useState(job?.location ?? '');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    job?.employmentType ?? 'FULL_TIME',
  );
  const [closesAt, setClosesAt] = useState(toDay(job?.closesAt ?? null));
  const [description, setDescription] = useState(job?.description ?? '');
  const [requirements, setRequirements] = useState(job?.requirements ?? '');
  const [seo, setSeo] = useState<SeoValue>({
    seoTitle: job?.seoTitle ?? '',
    seoDescription: job?.seoDescription ?? '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errors = toFieldErrors(error);

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    const body = {
      title,
      ...(slug && slug !== job?.slug ? { slug } : {}),
      department,
      location,
      employmentType,
      closesAt: fromDay(closesAt),
      description,
      requirements,
      seoTitle: seo.seoTitle,
      seoDescription: seo.seoDescription,
    };
    const res = job
      ? await api<AdminJobView>('PATCH', `/admin/careers/jobs/${job.id}`, body)
      : await api<AdminJobView>('POST', '/admin/careers/jobs', body);
    setBusy(null);
    if (!res.success) return setError(res);
    if (!job) router.push(`/admin/careers/${res.data.id}`);
    else {
      setNotice('Saved.');
      router.refresh();
    }
  }

  async function status(next: JobStatus) {
    if (!job) return;
    setBusy(next);
    setError(null);
    const res = await api('POST', `/admin/careers/jobs/${job.id}/status`, { status: next });
    setBusy(null);
    if (!res.success) return setError(res);
    setNotice('Updated.');
    router.refresh();
  }

  const dirty = job && description !== job.description;
  const action = (next: JobStatus, label: string, variant: 'secondary' | 'ghost' = 'secondary') => (
    <Button
      variant={variant}
      disabled={next === 'PUBLISHED' && Boolean(dirty)}
      loading={busy === next}
      onClick={() => void status(next)}
    >
      {label}
    </Button>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardBody className="flex flex-col gap-5">
            <Field label="Job title" error={errors.title}>
              {(a) => (
                <Input
                  {...a}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Location" error={errors.location}>
                {(a) => (
                  <Input
                    {...a}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    maxLength={160}
                    placeholder="Lagos (hybrid)"
                  />
                )}
              </Field>
              <Field label="Employment type" error={errors.employmentType}>
                {(a) => (
                  <Select
                    {...a}
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
                  >
                    {Object.values(EmploymentType).map((t) => (
                      <option key={t} value={t}>
                        {EMPLOYMENT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Department" optional error={errors.department}>
                {(a) => (
                  <Input
                    {...a}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    maxLength={80}
                  />
                )}
              </Field>
              <Field
                label="Closing date"
                optional
                hint="Applications stop after this day."
                error={errors.closesAt}
              >
                {(a) => (
                  <Input
                    {...a}
                    type="date"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Address" optional error={errors.slug}>
              {(a) => (
                <Input
                  {...a}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <MarkdownEditor
              label="Description"
              name="description"
              value={description}
              onChange={setDescription}
              mediaBase={mediaBase}
              maxLength={CMS_LIMITS.pageBody}
              error={errors.description}
              canUpload={canUpload}
            />
            <MarkdownEditor
              label="Requirements"
              name="requirements"
              value={requirements}
              onChange={setRequirements}
              mediaBase={mediaBase}
              maxLength={CMS_LIMITS.pageBody}
              rows={8}
              error={errors.requirements}
              canUpload={canUpload}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search" />
          <CardBody>
            <SeoFields value={seo} onChange={setSeo} errors={errors} canUpload={canUpload} />
          </CardBody>
        </Card>
      </div>
      <aside className="flex flex-col gap-3 xl:sticky xl:top-26 xl:self-start">
        <Card>
          <CardBody className="flex flex-col gap-3">
            {job && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">Status</span>
                <JobStatusBadge status={job.status} />
              </div>
            )}
            {job && (
              <p className="text-sm text-text-secondary">
                {job.applicationCount} application{job.applicationCount === 1 ? '' : 's'}
              </p>
            )}
            {error && error.code !== 'VALIDATION_ERROR' && (
              <Alert tone="error">{error.message}</Alert>
            )}
            {error?.code === 'VALIDATION_ERROR' && (
              <Alert tone="error">
                {errors.description ?? 'Please fix the highlighted fields.'}
              </Alert>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            <Button onClick={() => void save()} loading={busy === 'save'}>
              {job ? 'Save changes' : 'Create draft'}
            </Button>
            {job?.status === 'DRAFT' && action('PUBLISHED', 'Publish')}
            {job?.status === 'PUBLISHED' && (
              <>
                <Link
                  href={`/careers/${job.slug}`}
                  target="_blank"
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  View job <ExternalLink aria-hidden className="size-4" />
                </Link>
                {action('CLOSED', 'Close applications')}
                {action('DRAFT', 'Unpublish', 'ghost')}
              </>
            )}
            {job?.status === 'CLOSED' && (
              <>
                {action('PUBLISHED', 'Reopen')}
                {action('ARCHIVED', 'Archive', 'ghost')}
              </>
            )}
            {job?.status === 'DRAFT' && action('ARCHIVED', 'Archive', 'ghost')}
            {job?.status === 'ARCHIVED' && action('DRAFT', 'Restore as draft')}
            {job &&
              (job.status === 'DRAFT' || job.status === 'ARCHIVED') &&
              job.applicationCount === 0 && (
                <Button
                  variant="danger"
                  loading={busy === 'delete'}
                  onClick={async () => {
                    if (!window.confirm(`Delete “${job.title}” permanently?`)) return;
                    setBusy('delete');
                    const res = await api('DELETE', `/admin/careers/jobs/${job.id}`);
                    setBusy(null);
                    if (res.success) router.push('/admin/careers');
                    else setError(res);
                  }}
                >
                  Delete permanently
                </Button>
              )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
