import type { DataSource, QueryRunner } from 'typeorm';
import {
  formatCopCents,
  inspectTransaction,
  parseTransactionId,
  runInspectionCli,
  sanitizeInspection,
} from './inspect-transaction';

const inspectionRow = () => ({
  transactionId: '11111111-1111-4111-8111-111111111111',
  attemptNumber: 1,
  reference: 'pc_reference',
  transactionStatus: 'APPROVED',
  dispatchStatus: 'SUBMITTED',
  lastErrorCode: null,
  providerEnvironment: 'UAT_SANDBOX',
  providerTransactionId: 'provider-sensitive-id',
  quantity: 1,
  unitPriceCents: 1000,
  baseFeeCents: 100,
  deliveryFeeCents: 200,
  totalCents: 1300,
  currency: 'COP',
  transactionCreatedAt: '2026-01-01T00:00:00.000Z',
  submissionStartedAt: '2026-01-01T00:00:01.000Z',
  finalizedAt: '2026-01-01T00:00:02.000Z',
  checkoutId: '22222222-2222-4222-8222-222222222222',
  checkoutStatus: 'PAID',
  productId: '33333333-3333-4333-8333-333333333333',
  sku: 'SKU-1',
  physicalStock: 4,
  activeHeld: 0,
  available: 4,
  reservationId: '44444444-4444-4444-8444-444444444444',
  reservationStatus: 'CONFIRMED',
  reservationExpiresAt: '2026-01-01T00:10:00.000Z',
  deliveryId: '55555555-5555-4555-8555-555555555555',
  deliveryStatus: 'READY',
});

describe('transaction inspection', () => {
  it('accepts UUIDs and rejects values that could alter the query', () => {
    expect(parseTransactionId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    for (const value of ['', 'not-an-id', "' OR true --", undefined])
      expect(() => parseTransactionId(value)).toThrow('INVALID_TRANSACTION_ID');
  });

  it('returns operational facts without personal snapshots or raw provider id', () => {
    const output = sanitizeInspection({
      ...inspectionRow(),
      buyerSnapshot: { email: 'private@example.test' },
      deliverySnapshot: { address: 'private' },
    } as never);
    const serialized = JSON.stringify(output);
    expect(output.transaction.providerTransactionPresent).toBe(true);
    expect(output.transaction.providerTransactionFingerprint).toMatch(
      /^[0-9a-f]{16}$/,
    );
    expect(serialized).not.toContain('provider-sensitive-id');
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('address');
    expect(output.transaction.amounts).toMatchObject({
      unitPriceCents: 1000,
      unitPriceCop: '$ 10,00 COP',
      baseFeeCents: 100,
      baseFeeCop: '$ 1,00 COP',
      deliveryFeeCents: 200,
      deliveryFeeCop: '$ 2,00 COP',
      totalCents: 1300,
      totalCop: '$ 13,00 COP',
    });
  });

  it('formats integer COP cents without floating-point arithmetic', () => {
    expect(formatCopCents(12990000)).toBe('$ 129.900,00 COP');
    expect(formatCopCents('26130000')).toBe('$ 261.300,00 COP');
    expect(formatCopCents(-1)).toBe('-$ 0,01 COP');
    expect(() => formatCopCents('1.5')).toThrow('INVALID_COP_CENTS');
  });

  it('uses a parameterized READ ONLY transaction and closes the connection', async () => {
    const calls: string[] = [];
    const runnerState = { active: false };
    const connect = jest.fn(() => {
      calls.push('connect');
      return Promise.resolve();
    });
    const startTransaction = jest.fn(() => {
      calls.push('start');
      runnerState.active = true;
      return Promise.resolve();
    });
    const query = jest.fn((sql: string, parameters?: unknown[]) => {
      calls.push(sql.trim());
      return Promise.resolve(parameters ? [inspectionRow()] : []);
    });
    const commitTransaction = jest.fn(() => {
      calls.push('commit');
      runnerState.active = false;
      return Promise.resolve();
    });
    const rollbackTransaction = jest.fn(() => {
      calls.push('rollback');
      return Promise.resolve();
    });
    const release = jest.fn(() => {
      calls.push('release');
      return Promise.resolve();
    });
    const runner = {
      get isTransactionActive() {
        return runnerState.active;
      },
      connect,
      startTransaction,
      query,
      commitTransaction,
      rollbackTransaction,
      release,
    } as unknown as QueryRunner;
    const sourceState = { initialized: false };
    const initialize = jest.fn(() => {
      calls.push('initialize');
      sourceState.initialized = true;
      return Promise.resolve(source);
    });
    const destroy = jest.fn(() => {
      calls.push('destroy');
      sourceState.initialized = false;
      return Promise.resolve();
    });
    const source = {
      get isInitialized() {
        return sourceState.initialized;
      },
      initialize,
      createQueryRunner: jest.fn(() => runner),
      destroy,
    } as unknown as DataSource;

    const result = await inspectTransaction(
      '11111111-1111-4111-8111-111111111111',
      () => source,
    );

    expect(result?.transaction.amounts.totalCents).toBe(1300);
    expect(query).toHaveBeenNthCalledWith(1, 'SET TRANSACTION READ ONLY');
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE t.id = $1'),
      ['11111111-1111-4111-8111-111111111111'],
    );
    expect(calls).toEqual([
      'initialize',
      'connect',
      'start',
      'SET TRANSACTION READ ONLY',
      expect.stringContaining('SELECT'),
      'commit',
      'release',
      'destroy',
    ]);
    expect(rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rolls back, releases and destroys after a query failure', async () => {
    const runnerState = { active: false };
    const rollbackTransaction = jest.fn(() => {
      runnerState.active = false;
      return Promise.resolve();
    });
    const release = jest.fn(() => Promise.resolve());
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('private database detail'));
    const runner = {
      get isTransactionActive() {
        return runnerState.active;
      },
      connect: jest.fn(),
      startTransaction: jest.fn(() => {
        runnerState.active = true;
        return Promise.resolve();
      }),
      query,
      commitTransaction: jest.fn(),
      rollbackTransaction,
      release,
    } as unknown as QueryRunner;
    const destroy = jest.fn();
    const source = {
      isInitialized: true,
      initialize: jest.fn(),
      createQueryRunner: jest.fn(() => runner),
      destroy,
    } as unknown as DataSource;

    await expect(
      inspectTransaction('11111111-1111-4111-8111-111111111111', () => source),
    ).rejects.toThrow('private database detail');
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid UUID', 'invalid', 1],
    ['missing transaction', '11111111-1111-4111-8111-111111111111', 2],
    ['connection failure', '11111111-1111-4111-8111-111111111111', 1],
  ])('returns non-zero for %s', async (_case, argument, expected) => {
    const inspect = jest
      .fn()
      .mockImplementation(() =>
        _case === 'connection failure'
          ? Promise.reject(new Error('secret host detail'))
          : Promise.resolve(null),
      );
    const output: string[] = [];
    const errors: string[] = [];
    const code = await runInspectionCli(
      argument,
      inspect,
      (value) => output.push(value),
      (value) => errors.push(value),
    );
    expect(code).toBe(expected);
    expect(output).toEqual([]);
    expect(errors.join('')).not.toContain('secret host detail');
  });
});
