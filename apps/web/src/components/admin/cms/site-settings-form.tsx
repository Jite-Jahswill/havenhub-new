'use client';

import {
  ErrorCode,
  SOCIAL_NETWORK_LABELS,
  SocialNetwork,
  updateSiteSettingsSchema,
  type AdminSiteSettingsView,
  type SocialLink,
} from '@havenhub/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@havenhub/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { api, apiUpload } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

/** Site name, contact details, social links, footer, feature switches and retention periods. */
export function SiteSettingsForm({ settings }: { settings: AdminSiteSettingsView }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const [social, setSocial] = useState<SocialLink[]>(settings.socialLinks);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const retention = formText(f, 'cvRetentionDays');
    const subscriberRetention = formText(f, 'newsletterRetentionDays');
    const input = validate(updateSiteSettingsSchema, {
      siteName: formText(f, 'siteName'),
      tagline: formText(f, 'tagline'),
      contactEmail: formText(f, 'contactEmail'),
      contactPhone: formText(f, 'contactPhone'),
      contactAddress: formText(f, 'contactAddress'),
      footerText: formText(f, 'footerText'),
      socialLinks: social.filter((s) => s.url.trim()).map((s) => ({ ...s, url: s.url.trim() })),
      blogEnabled: f.get('blogEnabled') === 'on',
      careersEnabled: f.get('careersEnabled') === 'on',
      helpCenterEnabled: f.get('helpCenterEnabled') === 'on',
      newsletterEnabled: f.get('newsletterEnabled') === 'on',
      newsletterDoubleOptIn: f.get('newsletterDoubleOptIn') === 'on',
      newsletterConsentText: formText(f, 'newsletterConsentText'),
      cvRetentionDays: retention ? Number(retention) : null,
      newsletterRetentionDays: subscriberRetention ? Number(subscriberRetention) : null,
    });
    if (!input) return;
    if (await run(() => api('PATCH', '/admin/cms/site', input))) {
      setSaved(true);
      router.refresh();
    }
  }

  const err = (k: string) => fieldErrors[k];
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Identity & contact" />
        <CardBody className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Site name" error={err('siteName')}>
              {(a) => (
                <Input {...a} name="siteName" defaultValue={settings.siteName} maxLength={60} />
              )}
            </Field>
            <Field label="Tagline" optional error={err('tagline')}>
              {(a) => (
                <Input
                  {...a}
                  name="tagline"
                  defaultValue={settings.tagline ?? ''}
                  maxLength={160}
                />
              )}
            </Field>
            <Field label="Contact email" optional error={err('contactEmail')}>
              {(a) => (
                <Input
                  {...a}
                  name="contactEmail"
                  type="email"
                  defaultValue={settings.contactEmail ?? ''}
                />
              )}
            </Field>
            <Field label="Contact phone" optional error={err('contactPhone')}>
              {(a) => (
                <Input
                  {...a}
                  name="contactPhone"
                  type="tel"
                  defaultValue={settings.contactPhone ?? ''}
                  maxLength={40}
                />
              )}
            </Field>
          </div>
          <Field label="Address" optional error={err('contactAddress')}>
            {(a) => (
              <Input
                {...a}
                name="contactAddress"
                defaultValue={settings.contactAddress ?? ''}
                maxLength={300}
              />
            )}
          </Field>
          <Field label="Footer text" optional error={err('footerText')}>
            {(a) => (
              <Textarea
                {...a}
                name="footerText"
                rows={3}
                defaultValue={settings.footerText ?? ''}
                maxLength={500}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-text">Social links</legend>
            {social.map((s, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <Select
                  aria-label="Network"
                  value={s.network}
                  onChange={(e) =>
                    setSocial((l) =>
                      l.map((x, j) =>
                        j === i ? { ...x, network: e.target.value as SocialLink['network'] } : x,
                      ),
                    )
                  }
                  className="sm:w-44"
                >
                  {Object.values(SocialNetwork).map((n) => (
                    <option key={n} value={n}>
                      {SOCIAL_NETWORK_LABELS[n]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Profile URL"
                  placeholder="https://…"
                  value={s.url}
                  onChange={(e) =>
                    setSocial((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                  }
                  aria-invalid={err(`socialLinks.${i}.url`) ? true : undefined}
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Remove link"
                  onClick={() => setSocial((l) => l.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            ))}
            {Object.entries(fieldErrors)
              .filter(([k]) => k.startsWith('socialLinks'))
              .slice(0, 1)
              .map(([k, m]) => (
                <p key={k} className="text-xs font-medium text-error">
                  {m}
                </p>
              ))}
            {social.length < 10 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setSocial((l) => [...l, { network: 'INSTAGRAM', url: '' }])}
              >
                <Plus aria-hidden className="size-4" /> Add link
              </Button>
            )}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Features"
          description="Switched-off sections disappear from the site and its navigation."
        />
        <CardBody className="flex flex-col gap-3">
          <Toggle name="blogEnabled" label="Blog" defaultChecked={settings.blogEnabled} />
          <Toggle
            name="helpCenterEnabled"
            label="Help centre"
            defaultChecked={settings.helpCenterEnabled}
          />
          <Toggle name="careersEnabled" label="Careers" defaultChecked={settings.careersEnabled} />
          <Toggle
            name="newsletterEnabled"
            label="Newsletter signup"
            defaultChecked={settings.newsletterEnabled}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Consent & retention"
          description="These are technical settings. The wording and periods that satisfy your legal obligations are a decision for your legal or compliance adviser."
        />
        <CardBody className="flex flex-col gap-5">
          <Field
            label="Newsletter consent statement"
            optional
            hint="Shown next to the signup checkbox and stored with every subscriber’s consent record."
            error={err('newsletterConsentText')}
          >
            {(a) => (
              <Textarea
                {...a}
                name="newsletterConsentText"
                rows={3}
                defaultValue={settings.newsletterConsentText ?? ''}
                maxLength={1000}
              />
            )}
          </Field>
          <Toggle
            name="newsletterDoubleOptIn"
            label="Require email confirmation (double opt-in) before sending campaigns"
            defaultChecked={settings.newsletterDoubleOptIn}
          />
          <Field
            label="Erase former subscribers after (days)"
            optional
            hint="Leave empty to keep them. People who unsubscribed or never confirmed this long ago have their address removed; their consent history is kept without it."
            error={err('newsletterRetentionDays')}
          >
            {(a) => (
              <Input
                {...a}
                name="newsletterRetentionDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={settings.newsletterRetentionDays ?? ''}
                className="sm:w-40"
              />
            )}
          </Field>
          <Field
            label="Delete CVs after (days)"
            optional
            hint="Leave empty to keep CVs until deleted by hand. Applies to applications older than this."
            error={err('cvRetentionDays')}
          >
            {(a) => (
              <Input
                {...a}
                name="cvRetentionDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={settings.cvRetentionDays ?? ''}
                className="sm:w-40"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-col gap-3">
        {error && error.code !== ErrorCode.VALIDATION_ERROR && (
          <Alert tone="error">{error.message}</Alert>
        )}
        {error?.code === ErrorCode.VALIDATION_ERROR && (
          <Alert tone="error">Please fix the highlighted fields.</Alert>
        )}
        {saved && <Alert tone="success">Saved. The public site updates within a minute.</Alert>}
        <Button type="submit" loading={pending} className="self-end">
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-text">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

/** Logo and favicon: uploaded, re-encoded by the API, removable. */
export function BrandImages({ settings }: { settings: AdminSiteSettingsView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logo = useRef<HTMLInputElement>(null);
  const favicon = useRef<HTMLInputElement>(null);

  async function upload(kind: 'logo' | 'favicon', files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(kind);
    setError(null);
    const res = await apiUpload(`/admin/cms/site/${kind}`, file);
    setBusy(null);
    if (!res.success) setError(res.message);
    router.refresh();
  }
  async function remove(kind: 'logo' | 'favicon') {
    setBusy(`rm-${kind}`);
    const res = await api('DELETE', `/admin/cms/site/${kind}`);
    setBusy(null);
    if (!res.success) setError(res.message);
    router.refresh();
  }

  const item = (
    kind: 'logo' | 'favicon',
    url: string | null,
    ref: React.RefObject<HTMLInputElement | null>,
  ) => (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-text">{kind === 'logo' ? 'Logo' : 'Favicon'}</span>
      <div className="grid h-20 place-items-center rounded-control border border-border bg-surface-secondary p-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- re-encoded upload
          <img src={url} alt="" className="max-h-16 max-w-full object-contain" />
        ) : (
          <span className="text-xs text-text-muted">Default</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={busy === kind}
          onClick={() => ref.current?.click()}
        >
          Upload
        </Button>
        {url && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={busy === `rm-${kind}`}
            onClick={() => void remove(kind)}
          >
            Remove
          </Button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Upload ${kind}`}
        onChange={(e) => void upload(kind, e.target.files)}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader title="Logo & favicon" description="PNG, JPEG or WebP. SVG is not accepted." />
      <CardBody className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-6 sm:grid-cols-2">
          {item('logo', settings.logo?.url ?? null, logo)}
          {item('favicon', settings.faviconUrl, favicon)}
        </div>
      </CardBody>
    </Card>
  );
}
