import {
  operationalLog,
  providerFingerprint,
  writeOperationalLog,
} from './operational-log';

describe('operationalLog', () => {
  it('emits structured allowlisted metadata and drops arbitrary secrets', () => {
    const log = jest.fn<void, [string]>();
    writeOperationalLog({ log } as never, 'provider.response.received', {
      transactionId: '11111111-1111-4111-8111-111111111111',
      reference: 'pc_reference',
      operation: 'creation',
      providerHttpStatus: 201,
      durationMs: 12.6,
      errorCode: 'VALIDATED',
      authorization: 'Bearer secret',
      cardToken: 'tok_secret',
      buyer: { email: 'private@example.test' },
    } as never);
    const serialized = String(log.mock.calls[0][0]);
    expect(JSON.parse(serialized)).toMatchObject({
      event: 'provider.response.received',
      transactionId: '11111111-1111-4111-8111-111111111111',
      reference: 'pc_reference',
      providerHttpStatus: 201,
      durationMs: 13,
      errorCode: 'VALIDATED',
    });
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('tok_secret');
    expect(serialized).not.toContain('private@example.test');
  });

  it('can build the same structured payload for an injected sink', () => {
    expect(operationalLog('payment.sync.started', {})).toMatchObject({
      event: 'payment.sync.started',
    });
  });

  it('uses a stable non-reversible provider identifier fingerprint', () => {
    expect(providerFingerprint('provider-transaction-id')).toMatch(
      /^[0-9a-f]{16}$/,
    );
    expect(providerFingerprint('provider-transaction-id')).toBe(
      providerFingerprint('provider-transaction-id'),
    );
  });
});
