import { Alert, Container } from '@havenhub/ui';
import type { Metadata } from 'next';

import { NewsletterTokenAction } from '@/components/cms/newsletter-token-action';

export const metadata: Metadata = { title: 'Newsletter', robots: { index: false, follow: false } };

export default async function NewsletterUnsubscribePage({
  searchParams,
}: PageProps<'/newsletter/unsubscribe'>) {
  const { token } = await searchParams;
  const valid = typeof token === 'string' && token.length >= 20 && token.length <= 300;
  return (
    <Container className="py-16">
      {valid ? (
        <NewsletterTokenAction mode="unsubscribe" token={token} />
      ) : (
        <Alert tone="error" className="mx-auto max-w-md">
          This link is incomplete. Open it again from your email.
        </Alert>
      )}
    </Container>
  );
}
