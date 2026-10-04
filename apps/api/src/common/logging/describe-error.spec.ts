import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../generated/prisma/client';
import { SmtpSendError } from '../../infrastructure/mail/mail-transport.resolver';
import { AppException } from '../errors/app.exception';
import { describeError, framesOf } from './describe-error';

describe('describeError', () => {
  it('keeps class and code but never the message of database or SMTP errors', () => {
    const prisma = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on users_email_key (value: ada@example.com)',
      { code: 'P2002', clientVersion: '7' },
    );
    expect(describeError(prisma)).toEqual({
      errorName: 'PrismaClientKnownRequestError',
      errorCode: 'P2002',
    });
    expect(
      describeError(new SmtpSendError('The server refused the message.', 'EENVELOPE')),
    ).toEqual({
      errorName: 'SmtpSendError',
      errorCode: 'EENVELOPE',
    });
    const smtp = Object.assign(
      new Error('550 5.1.1 <ada@example.com>: Recipient address rejected'),
      {
        code: 'EENVELOPE',
      },
    );
    expect(JSON.stringify(describeError(smtp))).not.toContain('ada@example.com');
  });

  it('keeps our own messages (bounded) and API error codes', () => {
    expect(describeError(new Error('Lock lost'))).toEqual({
      errorName: 'Error',
      errorMessage: 'Lock lost',
    });
    expect(
      describeError(new AppException(HttpStatus.BAD_GATEWAY, 'PAYMENT_VERIFICATION_FAILED', 'x')),
    ).toMatchObject({
      errorName: 'AppException',
      errorCode: 'PAYMENT_VERIFICATION_FAILED',
    });
    expect(describeError(new Error('x'.repeat(1000))).errorMessage).toHaveLength(300);
    expect(describeError('a string')).toEqual({ errorName: 'string' });
  });

  it('strips the message line from stack traces', () => {
    const error = new Error('secret detail ada@example.com');
    const frames = framesOf(error)!;
    expect(frames).not.toContain('secret detail');
    expect(frames.split('\n')[0]).toMatch(/^\s+at /);
  });
});
