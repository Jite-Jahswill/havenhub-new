import type { AgentPublicView, PropertySearchResult } from '@havenhub/shared';
import { Badge, Container } from '@havenhub/ui';
import { BadgeCheck, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { AgentAvatar } from '@/components/properties/agent-avatar';
import { PropertyCard } from '@/components/properties/property-card';
import { ShareButton } from '@/components/properties/share-button';
import { serverApi, serverApiData } from '@/lib/api/server';
import { env } from '@/lib/env';
import { SERVICE_LABELS } from '@/lib/labels';
import { getCurrentUser } from '@/lib/session';

const UUID = /^[0-9a-f-]{36}$/i;

const getAgent = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  const res = await serverApi<AgentPublicView>(`/agents/${id}`);
  return res.success ? res.data : null;
});

export async function generateMetadata({ params }: PageProps<'/agents/[id]'>): Promise<Metadata> {
  const agent = await getAgent((await params).id);
  if (!agent) return { title: 'Agent not found', robots: { index: false } };
  return {
    title: `${agent.displayName} · Verified agent`,
    description: `Browse properties listed by ${agent.displayName}, a verified HavenHub agent${agent.city ? ` in ${agent.city}` : ''}.`,
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/agents/${agent.id}` },
  };
}

export default async function AgentProfilePage({ params }: PageProps<'/agents/[id]'>) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  const [listings, user] = await Promise.all([
    serverApiData<PropertySearchResult>(`/properties?agent=${agent.id}&pageSize=48`),
    getCurrentUser(),
  ]);
  const viewer = !user ? 'guest' : user.accountType === 'CUSTOMER' ? 'customer' : 'other';
  const favorites = new Set(listings?.favoriteIds ?? []);

  return (
    <Container className="py-10 lg:py-14">
      <header className="flex flex-col gap-6 border-b border-border pb-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <AgentAvatar name={agent.displayName} url={agent.avatarUrl} size="lg" />
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-text sm:text-3xl">
              {agent.displayName}
              <BadgeCheck aria-label="Verified agent" className="size-6 text-success" />
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
              {agent.city && (
                <span className="flex items-center gap-1">
                  <MapPin aria-hidden className="size-4" />
                  {agent.city}, {agent.state}
                </span>
              )}
              <span>Member since {new Date(agent.memberSince).getFullYear()}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="success">Verified by HavenHub</Badge>
              {agent.serviceTypes.map((s) => (
                <Badge key={s}>{SERVICE_LABELS[s]}</Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <ShareButton title={agent.displayName} />
          <p className="text-xs text-text-muted">Direct messaging with agents is coming soon.</p>
        </div>
      </header>

      <section aria-labelledby="listings-heading" className="mt-10">
        <h2 id="listings-heading" className="mb-6 text-xl font-bold tracking-tight text-text">
          Listings ({listings?.total ?? 0})
        </h2>
        {listings && listings.items.length > 0 ? (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.items.map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                viewer={viewer}
                favorite={favorites.has(property.id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-text-secondary">This agent has no live listings right now.</p>
        )}
      </section>
    </Container>
  );
}
