'use client';

import { useEffect, useRef } from 'react';

/** Records one view per page load; the API de-duplicates per visitor. */
export function ViewBeacon({ propertyId }: { propertyId: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch(`/api/v1/properties/${propertyId}/views`, { method: 'POST', keepalive: true }).catch(
      () => undefined,
    );
  }, [propertyId]);
  return null;
}
