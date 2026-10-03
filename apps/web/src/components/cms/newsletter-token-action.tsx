'use client';

import { Alert, Button, Card, CardBody } from '@havenhub/ui';
import { useState } from 'react';

import { api } from '@/lib/api/client';

/**
 * Confirms or cancels a newsletter subscription — only when the person
 * clicks (email link scanners fetch links but do not press buttons).
 */
export function NewsletterTokenAction({
  mode,
  token,
}: {
  mode: 'confirm' | 'unsubscribe';
  token: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function act() {
    setState('busy');
    const res = await api('POST', `/newsletter/${mode}`, { token });
    if (res.success) setState('done');
    else {
      setMessage(res.message);
      setState('error');
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardBody className="flex flex-col gap-4 text-center">
        <h1 className="text-xl font-bold text-text">
          {mode === 'confirm' ? 'Confirm your subscription' : 'Unsubscribe from the newsletter'}
        </h1>
        {state === 'done' ? (
          <Alert tone="success">
            {mode === 'confirm'
              ? 'You’re subscribed. Thanks for joining!'
              : 'You’ve been unsubscribed. You won’t receive the newsletter any more.'}
          </Alert>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              {mode === 'confirm'
                ? 'Press the button to start receiving the HavenHub newsletter.'
                : 'Press the button to stop receiving the HavenHub newsletter.'}
            </p>
            {state === 'error' && <Alert tone="error">{message}</Alert>}
            <Button
              onClick={() => void act()}
              loading={state === 'busy'}
              variant={mode === 'confirm' ? 'primary' : 'danger'}
            >
              {mode === 'confirm' ? 'Confirm subscription' : 'Unsubscribe'}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
