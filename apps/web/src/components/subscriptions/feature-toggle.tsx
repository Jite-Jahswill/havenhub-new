'use client';

import { Button } from '@havenhub/ui';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';
import { ApiErrorAlert } from './upgrade-prompt';

/** Feature / un-feature a published listing; the plan's allowance is enforced by the API. */
export function FeatureToggle({ propertyId, featured }: { propertyId: string; featured: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();

  async function toggle() {
    const done = await run(() =>
      api(featured ? 'DELETE' : 'POST', `/agents/me/properties/${propertyId}/feature`),
    );
    if (done) router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <ApiErrorAlert error={error} />
      <Button
        variant="secondary"
        onClick={toggle}
        loading={pending}
        aria-pressed={featured}
        className="self-start"
      >
        <Star aria-hidden className={featured ? 'size-4 fill-current text-primary' : 'size-4'} />
        {featured ? 'Featured — remove' : 'Feature this listing'}
      </Button>
    </div>
  );
}
