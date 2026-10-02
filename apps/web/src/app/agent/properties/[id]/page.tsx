import type { AgentProfileView, AgentPropertyView, AmenityView } from '@havenhub/shared';
import { Alert, Card, CardBody } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MediaManager } from '@/components/agent-properties/media-manager';
import { PropertyForm } from '@/components/agent-properties/property-form';
import { StatusPanel } from '@/components/agent-properties/status-panel';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { FeatureToggle } from '@/components/subscriptions/feature-toggle';
import { serverApi, serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Edit property' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EditPropertyPage({
  params,
  searchParams,
}: PageProps<'/agent/properties/[id]'>) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID.test(id)) notFound();
  const res = await serverApi<AgentPropertyView>(`/agents/me/properties/${id}`);
  if (!res.success) notFound();
  const property = res.data;
  const [amenities, profile, plan] = await Promise.all([
    serverApiData<AmenityView[]>('/amenities'),
    serverApiData<AgentProfileView>('/agents/me'),
    serverApiData<{ usage: { key: string; limit: number | null }[] }>('/agents/me/plan'),
  ]);
  // Limits come from the agent's plan; null = unlimited (the API enforces them either way).
  const limit = (key: string) => plan?.usage.find((u) => u.key === key)?.limit ?? null;
  const limits = { images: limit('images'), videos: limit('videos') };
  const editable = ['DRAFT', 'REJECTED', 'PUBLISHED'].includes(property.status);
  const restricted =
    profile?.verificationStatus === 'SUSPENDED' || profile?.verificationStatus === 'BLOCKED';
  const locked = !editable || restricted;

  return (
    <>
      <Link href="/agent/properties" className="text-sm text-text-secondary hover:text-text">
        ← Properties
      </Link>
      <div className="mt-4">
        <PageHeader
          title={property.title}
          description={[property.city, property.state].filter(Boolean).join(', ') || undefined}
        />
      </div>
      {created === '1' && (
        <Alert tone="success" className="mb-6">
          Draft created. Add photos below, then submit for review when everything is complete.
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <MediaManager property={property} limits={limits} locked={locked} />
          <PropertyForm property={property} amenities={amenities ?? []} locked={locked} />
        </div>
        <aside className="flex flex-col gap-6 xl:sticky xl:top-26 xl:self-start">
          <StatusPanel
            property={property}
            agentVerified={profile?.verificationStatus === 'VERIFIED'}
          />
          {(property.status === 'PUBLISHED' || property.featured) && !restricted && (
            <Card>
              <CardBody className="flex flex-col gap-3">
                <span className="text-sm font-semibold text-text">Featured listing</span>
                <p className="text-sm text-text-secondary">
                  {property.featured
                    ? 'This listing is featured. It uses one of your plan’s featured slots.'
                    : 'Featured listings stand out in search. Your plan sets how many you can feature.'}
                </p>
                <FeatureToggle propertyId={property.id} featured={property.featured} />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
