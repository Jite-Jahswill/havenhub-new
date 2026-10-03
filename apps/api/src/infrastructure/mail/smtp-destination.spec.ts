import { describe, expect, it } from 'vitest';

import { isForbiddenAddress, resolvePublicAddress, SmtpDestinationError } from './smtp-destination';

describe('SMTP destination checks', () => {
  it('allows public unicast addresses', () => {
    for (const address of [
      '8.8.8.8',
      '203.0.114.10',
      '2a00:1450:4009:81f::200e',
      '::ffff:8.8.8.8',
    ]) {
      expect(isForbiddenAddress(address), address).toBe(false);
    }
  });

  it('blocks loopback, private, link-local, reserved and mapped forms of them', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.4',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isForbiddenAddress(address), address).toBe(true);
    }
  });

  it('refuses a host if any resolved address is internal, and returns the checked address', async () => {
    const dns = (answers: string[]) => () =>
      Promise.resolve(answers.map((address) => ({ address, family: 4 })));
    await expect(resolvePublicAddress('a.test', dns(['8.8.8.8']))).resolves.toBe('8.8.8.8');
    await expect(
      resolvePublicAddress('a.test', dns(['8.8.8.8', '10.0.0.1'])),
    ).rejects.toBeInstanceOf(SmtpDestinationError);
    await expect(resolvePublicAddress('a.test', dns([]))).rejects.toBeInstanceOf(
      SmtpDestinationError,
    );
    await expect(resolvePublicAddress('127.0.0.1')).rejects.toBeInstanceOf(SmtpDestinationError);
  });
});
