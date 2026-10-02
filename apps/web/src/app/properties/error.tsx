'use client';

import { Button, Container } from '@havenhub/ui';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <Container className="max-w-xl py-28 text-center">
      <h1 className="text-2xl font-bold text-text">We couldn’t load properties</h1>
      <p className="mt-3 text-text-secondary">Please check your connection and try again.</p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </Container>
  );
}
