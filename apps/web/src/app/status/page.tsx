import type { ApiResponse, HealthCheck } from '@havenhub/shared';
import { Badge, Container } from '@havenhub/ui';
import type { Metadata } from 'next';

import { networkError } from '@/lib/api/errors';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'System status',
  robots: { index: false },
};

// Always reflect live status.
export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const result = await fetch(`${env.API_INTERNAL_URL}/api/health`, { cache: 'no-store' })
    .then((res) => res.json() as Promise<ApiResponse<HealthCheck>>)
    .catch(() => networkError);

  return (
    <section className="py-20">
      <Container className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-text">System status</h1>
        {result.success ? (
          <div className="mt-8 rounded-card border border-border bg-surface p-7 shadow-card">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-text">API</span>
              <Badge tone={result.data.status === 'ok' ? 'success' : 'warning'}>
                {result.data.status === 'ok' ? 'Operational' : 'Degraded'}
              </Badge>
            </div>
            <dl className="mt-6 divide-y divide-border">
              {Object.entries(result.data.checks).map(([name, status]) => (
                <div key={name} className="flex items-center justify-between py-3">
                  <dt className="text-text-secondary capitalize">{name}</dt>
                  <dd>
                    <Badge tone={status === 'up' ? 'success' : 'error'}>{status}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="mt-8 rounded-card bg-error-subtle p-7 text-error" role="alert">
            {result.message}
          </div>
        )}
      </Container>
    </section>
  );
}
