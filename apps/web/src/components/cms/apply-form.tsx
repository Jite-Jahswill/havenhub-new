'use client';

import { CMS_LIMITS, jobApplicationSchema } from '@havenhub/shared';
import { Alert, Button, Field, Input, Textarea } from '@havenhub/ui';
import { CheckCircle2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const MAX_MB = CMS_LIMITS.cvBytes / (1024 * 1024);

/**
 * Job application: name, email, phone, cover note and a CV (PDF or DOCX,
 * 5 MB). Sent as multipart; the API re-checks everything, including the
 * file's real type.
 */
export function ApplyForm({ slug }: { slug: string }) {
  const { pending, error, fieldErrors, validate, setError } = useApiAction();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = validate(jobApplicationSchema, {
      fullName: formText(form, 'fullName'),
      email: formText(form, 'email'),
      phone: formText(form, 'phone'),
      coverNote: formText(form, 'coverNote'),
    });
    const cv = form.get('cv');
    const file = cv instanceof File && cv.size > 0 ? cv : null;
    const cvProblem = !file
      ? 'Attach your CV.'
      : !/\.(pdf|docx)$/i.test(file.name)
        ? 'Upload a PDF or Word (.docx) document.'
        : file.size > CMS_LIMITS.cvBytes
          ? `CVs must be ${MAX_MB} MB or smaller.`
          : null;
    setFileError(cvProblem);
    if (!input || cvProblem || !file) return;

    const body = new FormData();
    body.append('fullName', input.fullName);
    body.append('email', input.email);
    body.append('phone', input.phone);
    if (input.coverNote) body.append('coverNote', input.coverNote);
    body.append('cv', file);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/careers/jobs/${encodeURIComponent(slug)}/applications`, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (res.status === 413) {
        setFileError(`CVs must be ${MAX_MB} MB or smaller.`);
        return;
      }
      const json = (await res.json()) as { success: boolean; message?: string; code?: string };
      if (json.success) setDone(true);
      else
        setError({
          success: false,
          code: json.code ?? 'ERROR',
          message: json.message ?? 'Something went wrong.',
        });
    } catch {
      setError({
        success: false,
        code: 'NETWORK_ERROR',
        message: 'Could not reach HavenHub. Check your connection and try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-card border border-border bg-surface p-6"
      >
        <CheckCircle2 aria-hidden className="size-6 shrink-0 text-success" />
        <div>
          <p className="font-semibold text-text">Application sent</p>
          <p className="mt-1 text-sm text-text-secondary">
            Thank you. We’ve emailed you a confirmation and will be in touch if your application
            moves forward.
          </p>
        </div>
      </div>
    );
  }
  return (
    <form
      method="post"
      encType="multipart/form-data"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      <Field label="Full name" error={fieldErrors.fullName}>
        {(a) => <Input {...a} name="fullName" autoComplete="name" maxLength={120} />}
      </Field>
      <Field label="Email address" error={fieldErrors.email}>
        {(a) => <Input {...a} name="email" type="email" autoComplete="email" />}
      </Field>
      <Field label="Phone number" error={fieldErrors.phone}>
        {(a) => <Input {...a} name="phone" type="tel" autoComplete="tel" />}
      </Field>
      <Field label="Cover note" optional error={fieldErrors.coverNote}>
        {(a) => <Textarea {...a} name="coverNote" rows={5} maxLength={CMS_LIMITS.coverNote} />}
      </Field>
      <Field
        label="CV"
        hint={`PDF or Word (.docx), up to ${MAX_MB} MB.`}
        error={fileError ?? undefined}
      >
        {(a) => (
          <input
            {...a}
            name="cv"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-control file:border-0 file:bg-surface-secondary file:px-4 file:py-2 file:font-medium file:text-text"
          />
        )}
      </Field>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <Button type="submit" loading={pending || submitting} className="self-start">
        Send application
      </Button>
    </form>
  );
}
