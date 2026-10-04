import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AccountError from '../app/account/error';
import AdminError from '../app/admin/error';
import AgentError from '../app/agent/error';
import RootError from '../app/error';
import GlobalError from '../app/global-error';
import { ErrorState } from './error-state';

/** An error carrying everything that must never be shown. */
function sensitiveError(digest?: string) {
  const error = new Error(
    'PrismaClientKnownRequestError: duplicate key value violates "users_email_key" at postgresql://admin:hunter2@10.0.0.5:5432/havenhub; Paystack sk_live_abc123',
  ) as Error & { digest?: string };
  error.stack =
    'Error: boom\n    at /srv/app/apps/api/src/modules/payments/payments.service.ts:120:7';
  if (digest) error.digest = digest;
  return error;
}

const LEAKS =
  /Prisma|users_email_key|hunter2|10\.0\.0\.5|postgresql|sk_live|payments\.service|\/srv\/app|boom/;

describe('error boundaries', () => {
  it('render a branded message with retry, never the error details', () => {
    for (const [Boundary, home] of [
      [RootError, '/'],
      [AccountError, '/account'],
      [AgentError, '/agent'],
      [AdminError, '/admin'],
    ] as const) {
      const html = renderToStaticMarkup(
        <Boundary error={sensitiveError('4021337908')} retry={vi.fn()} />,
      );
      expect(html).toContain('Something went wrong');
      expect(html).toContain('Try again');
      expect(html).toContain(`href="${home}"`);
      expect(html).toContain('Reference: <span class="font-mono">4021337908</span>');
      expect(html).not.toMatch(LEAKS);
    }
  });

  it('global error renders its own document safely', () => {
    const html = renderToStaticMarkup(<GlobalError error={sensitiveError()} retry={vi.fn()} />);
    expect(html).toMatch(/^<html lang="en-NG">/);
    expect(html).toContain('HavenHub could not be loaded');
    expect(html).not.toMatch(LEAKS);
    expect(html).not.toContain('Reference:');
  });

  it('only shows a well-formed reference', () => {
    const html = renderToStaticMarkup(
      <ErrorState digest={'<script>alert(1)</script>'} retry={vi.fn()} />,
    );
    expect(html).not.toContain('Reference:');
    expect(html).not.toContain('<script>');
  });
});
