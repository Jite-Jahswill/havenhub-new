'use client';

import {
  ErrorCode,
  Sex,
  submitAgentIdentitySchema,
  updateAgentProfileSchema,
  upsertPayoutAccountSchema,
  type AgentProfileView,
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
  cn,
} from '@havenhub/ui';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { ID_DOCUMENT_LABELS, PROFILE_FIELD_LABELS, SERVICE_LABELS } from '@/lib/labels';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const NIGERIAN_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
];

const editableIdentity = (p: AgentProfileView) =>
  p.verificationStatus === 'PENDING' || p.verificationStatus === 'REJECTED';

function useSaved() {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return {
    saved,
    reset: () => setSaved(false),
    done: () => {
      setSaved(true);
      router.refresh();
    },
  };
}

function FormAlerts({
  saved,
  message,
  error,
}: {
  saved: boolean;
  message: string;
  error: ReturnType<typeof useApiAction>['error'];
}) {
  return (
    <>
      {saved && <Alert tone="success">{message}</Alert>}
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
    </>
  );
}

export function BusinessProfileForm({ profile }: { profile: AgentProfileView }) {
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const status = useSaved();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    status.reset();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => formText(form, name);
    const input = validate(updateAgentProfileSchema, {
      businessName: text('businessName') || null,
      bio: text('bio') || null,
      sex: text('sex'),
      serviceTypes: form.getAll('serviceTypes'),
      addressLine: text('addressLine'),
      city: text('city'),
      lga: text('lga'),
      state: text('state'),
    });
    if (input && (await run(() => api('PATCH', '/agents/me', input)))) status.done();
  }

  return (
    <Card id="business" className="scroll-mt-28">
      <CardHeader title="Business profile" description="Shown to customers once you’re verified." />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormAlerts saved={status.saved} message="Profile saved." error={error} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Business name" optional error={fieldErrors.businessName}>
              {(a) => (
                <Input {...a} name="businessName" defaultValue={profile.businessName ?? ''} />
              )}
            </Field>
            <Field label="Sex" error={fieldErrors.sex}>
              {(a) => (
                <Select {...a} name="sex" defaultValue={profile.sex}>
                  <option value={Sex.FEMALE}>Female</option>
                  <option value={Sex.MALE}>Male</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="About you" optional error={fieldErrors.bio}>
            {(a) => (
              <Textarea {...a} name="bio" defaultValue={profile.bio ?? ''} maxLength={1500} />
            )}
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-text">Services you offer</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Object.entries(SERVICE_LABELS).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-3 rounded-control border border-border px-3.5 py-2.5 text-sm has-checked:border-primary has-checked:bg-primary-subtle"
                >
                  <input
                    type="checkbox"
                    name="serviceTypes"
                    value={value}
                    defaultChecked={profile.serviceTypes.includes(value as never)}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
            {fieldErrors.serviceTypes && (
              <p className="mt-1.5 text-xs font-medium text-error">{fieldErrors.serviceTypes}</p>
            )}
          </fieldset>
          <Field label="Street address" error={fieldErrors.addressLine}>
            {(a) => (
              <Input
                {...a}
                name="addressLine"
                defaultValue={profile.addressLine ?? ''}
                autoComplete="street-address"
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="City / town" error={fieldErrors.city}>
              {(a) => <Input {...a} name="city" defaultValue={profile.city ?? ''} />}
            </Field>
            <Field label="LGA" error={fieldErrors.lga}>
              {(a) => <Input {...a} name="lga" defaultValue={profile.lga ?? ''} />}
            </Field>
            <Field label="State" error={fieldErrors.state}>
              {(a) => (
                <Select {...a} name="state" defaultValue={profile.state ?? ''}>
                  <option value="" disabled>
                    Select
                  </option>
                  {NIGERIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div>
            <Button type="submit" loading={pending}>
              Save profile
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function IdentityForm({ profile }: { profile: AgentProfileView }) {
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const status = useSaved();
  const editable = editableIdentity(profile);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    status.reset();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = validate(submitAgentIdentitySchema, {
      nin: form.get('nin'),
      idDocumentType: form.get('idDocumentType'),
    });
    if (input && (await run(() => api('PUT', '/agents/me/identity', input)))) {
      formElement.reset();
      status.done();
    }
  }

  return (
    <Card id="identity" className="scroll-mt-28">
      <CardHeader
        title="Identity"
        description={
          <span className="inline-flex items-center gap-1.5">
            <Lock aria-hidden className="size-3.5" /> Encrypted and never shown publicly.
          </span>
        }
      />
      <CardBody className="flex flex-col gap-5">
        {profile.identity.submitted && (
          <dl className="grid gap-4 rounded-control bg-surface-secondary px-4 py-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-muted">NIN on file</dt>
              <dd className="font-medium text-text tabular-nums">{profile.identity.ninMasked}</dd>
            </div>
            <div>
              <dt className="text-text-muted">ID document</dt>
              <dd className="font-medium text-text">
                {profile.identity.idDocumentType
                  ? ID_DOCUMENT_LABELS[profile.identity.idDocumentType]
                  : '—'}
              </dd>
            </div>
          </dl>
        )}
        {editable ? (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            <FormAlerts saved={status.saved} message="Identity details saved." error={error} />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={profile.identity.submitted ? 'Replace NIN' : 'NIN'}
                error={fieldErrors.nin}
                hint="11 digits"
              >
                {(a) => (
                  <Input {...a} name="nin" inputMode="numeric" autoComplete="off" maxLength={11} />
                )}
              </Field>
              <Field label="ID document type" error={fieldErrors.idDocumentType}>
                {(a) => (
                  <Select
                    {...a}
                    name="idDocumentType"
                    defaultValue={profile.identity.idDocumentType ?? ''}
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    {Object.entries(ID_DOCUMENT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div>
              <Button type="submit" loading={pending}>
                Save identity
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-text-secondary">
            Identity details are locked while under review or after verification. Contact support to
            change them.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function PayoutForm({ profile }: { profile: AgentProfileView }) {
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const status = useSaved();
  const account = profile.payoutAccount;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    status.reset();
    const form = new FormData(event.currentTarget);
    const input = validate(upsertPayoutAccountSchema, {
      bankName: form.get('bankName'),
      bankCode: form.get('bankCode'),
      accountNumber: form.get('accountNumber'),
      accountName: form.get('accountName'),
    });
    if (input && (await run(() => api('PUT', '/agents/me/payout-account', input)))) status.done();
  }

  return (
    <Card id="payout" className="scroll-mt-28">
      <CardHeader
        title="Payout account"
        description="Where your earnings are paid. Encrypted at rest."
      />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormAlerts saved={status.saved} message="Payout account saved." error={error} />
          {account && (
            <p className="text-sm text-text-secondary">
              Current: <span className="font-medium text-text">{account.bankName}</span> ·{' '}
              <span className="tabular-nums">{account.accountNumberMasked}</span> ·{' '}
              {account.accountName}
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Bank name" error={fieldErrors.bankName}>
              {(a) => <Input {...a} name="bankName" defaultValue={account?.bankName ?? ''} />}
            </Field>
            <Field label="Bank code" error={fieldErrors.bankCode} hint="CBN bank code, e.g. 058">
              {(a) => (
                <Input
                  {...a}
                  name="bankCode"
                  inputMode="numeric"
                  defaultValue={account?.bankCode ?? ''}
                />
              )}
            </Field>
            <Field label="Account number" error={fieldErrors.accountNumber} hint="10-digit NUBAN">
              {(a) => (
                <Input
                  {...a}
                  name="accountNumber"
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Account name" error={fieldErrors.accountName}>
              {(a) => <Input {...a} name="accountName" defaultValue={account?.accountName ?? ''} />}
            </Field>
          </div>
          <div>
            <Button type="submit" loading={pending}>
              {account ? 'Update payout account' : 'Save payout account'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function SubmitVerification({ profile }: { profile: AgentProfileView }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  if (!editableIdentity(profile)) return null;

  const missing = (error?.details as { missing?: string[] } | undefined)?.missing;

  async function submit() {
    if (await run(() => api('POST', '/agents/me/verification'))) router.refresh();
  }

  return (
    <Card className={cn('border-primary/30 bg-primary-subtle/40')}>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-text">Ready for verification?</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Submit once your business profile and identity are complete. Our team will review them.
          </p>
          {error && (
            <p className="mt-2 text-sm font-medium text-error" role="alert">
              {error.message}
              {missing?.length
                ? ` Still needed: ${missing.map((m) => PROFILE_FIELD_LABELS[m] ?? m).join(', ')}.`
                : ''}
            </p>
          )}
        </div>
        <Button onClick={submit} loading={pending} className="shrink-0">
          Submit for verification
        </Button>
      </CardBody>
    </Card>
  );
}
