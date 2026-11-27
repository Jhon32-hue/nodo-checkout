import { okAsync, errAsync, ResultAsync } from 'neverthrow';
import { createHash } from 'node:crypto';
import {
  StartPayment,
  SyncPayment,
  FinalizePayment,
  GetPaymentConfig,
} from './payment-cases';
import { canonicalPay, validPay } from '../domain/payment';
import type {
  PayInput,
  PaymentRecord,
  Observation,
  PublicPaymentConfig,
} from '../domain/payment';
import type {
  PaymentStore,
  PaymentGateway,
  PaymentContext,
} from './payment-ports';
const hash = {
  hash: (s: string) => createHash('sha256').update(s).digest('hex'),
};
const input = (): PayInput => ({
  cardToken: ' opaque ',
  installments: 1,
  acceptance: {
    acceptanceToken: 'policy',
    personalAuthToken: 'personal',
    policyAccepted: true,
    personalDataAccepted: true,
  },
});
const config: PublicPaymentConfig = {
  environment: 'UAT_SANDBOX',
  publicKey: 'pub_test_fixture',
  tokenizationPublicKey: 'fixture-rsa-public-key',
  tokenizationUrl: 'https://example.test/tokenize',
  installments: 1,
  acceptance: {
    acceptanceToken: 'policy',
    personalAuthToken: 'personal',
    policyUrl: 'https://example.test/policy',
    personalDataUrl: 'https://example.test/privacy',
  },
};
function fixture() {
  const record: PaymentRecord = {
    view: {
      id: 'local',
      checkoutId: 'checkout',
      status: 'PENDING',
      dispatchStatus: 'NOT_SENT',
      reservationExpiresAt: new Date(Date.now() + 600000).toISOString(),
      deliveryId: null,
    },
    reference: 'reference',
    amountCents: 100,
    currency: 'COP',
    quantity: 1,
    buyer: {
      fullName: 'Buyer',
      email: 'buyer@example.test',
      phone: '+573000000000',
    },
    environment: 'UAT_SANDBOX',
    providerId: null,
    payHash: null,
    startedAt: null,
    reservationStatus: 'HELD',
    expiresAt: new Date(Date.now() + 600000),
  };
  const observation: Observation = {
    id: 'remote',
    reference: 'reference',
    amountCents: 100,
    currency: 'COP',
    status: 'APPROVED',
    environment: 'UAT_SANDBOX',
  };
  const claim = jest.fn((value: string, _evidence: unknown, now: Date) => {
    record.payHash = value;
    record.startedAt = now;
    record.view.dispatchStatus = 'IN_FLIGHT';
    return Promise.resolve();
  });
  const expire = jest.fn(() => {
    record.view.status = 'EXPIRED';
    record.reservationStatus = 'RELEASED';
    return Promise.resolve();
  });
  const unknown = jest.fn(() => {
    if (record.view.dispatchStatus === 'IN_FLIGHT')
      record.view.dispatchStatus = 'UNKNOWN';
    return Promise.resolve();
  });
  const observe = jest.fn((o: Observation) => {
    record.providerId = o.id;
    record.view.dispatchStatus = 'SUBMITTED';
    record.view.status = o.status;
    return Promise.resolve();
  });
  const ctx: PaymentContext = {
    record,
    claim,
    expire,
    unknown,
    submitted: (id) => {
      record.providerId = id;
      record.view.dispatchStatus = 'SUBMITTED';
      return Promise.resolve();
    },
    observe,
    view: () => Promise.resolve({ ...record.view }),
  };
  const store: PaymentStore = {
    read: () => okAsync(record),
    run: (_s, _id, work) =>
      ResultAsync.fromPromise(work(ctx), () => ({
        kind: 'PERSISTENCE_UNAVAILABLE' as const,
      })).andThen((r) => r),
  };
  const gateway: PaymentGateway = {
    configuration: jest.fn(() => okAsync(config)),
    validateAcceptance: jest.fn(() => okAsync(undefined)),
    create: jest.fn(() => okAsync(observation)),
    get: jest.fn(() => okAsync(observation)),
  };
  const finalizer = new FinalizePayment(store);
  return {
    record,
    observation,
    store,
    gateway,
    claim,
    expire,
    unknown,
    observe,
    finalizer,
    start: new StartPayment(store, gateway, hash, finalizer),
    sync: new SyncPayment(store, gateway, finalizer),
  };
}
describe('Payment decisions without SQL or HTTP', () => {
  it('validates inputs without changing opaque strings or canonical field order', () => {
    const p = input();
    expect(validPay(p).isOk()).toBe(true);
    expect(canonicalPay(p)).toContain(' opaque ');
    const reordered = {
      acceptance: {
        personalDataAccepted: true,
        policyAccepted: true,
        personalAuthToken: 'personal',
        acceptanceToken: 'policy',
      },
      installments: 1,
      cardToken: ' opaque ',
    };
    expect(canonicalPay(p)).toBe(canonicalPay(reordered));
  });
  it.each([
    { cardToken: '' },
    { cardToken: 'x'.repeat(1025) },
    { installments: 2 },
    { acceptance: { ...input().acceptance, policyAccepted: false } },
    {
      acceptance: {
        ...input().acceptance,
        personalAuthToken: 'x'.repeat(8193),
      },
    },
  ])('rejects invalid input before claim %p', async (change) => {
    const f = fixture();
    const r = await f.start.execute('owner', 'local', {
      ...input(),
      ...change,
    });
    expect(r.isErr() && r.error.kind).toBe('INVALID_PAYMENT_INPUT');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('claims before sending, stores only hashes and finalizes the verified result', async () => {
    const f = fixture();
    const r = await f.start.execute('owner', 'local', input());
    expect(r.isOk() && r.value.status).toBe('APPROVED');
    expect(f.claim).toHaveBeenCalledWith(
      hash.hash(canonicalPay(input())),
      {
        policyAccepted: true,
        personalDataAccepted: true,
        acceptanceTokenHash: hash.hash('policy'),
        personalAuthTokenHash: hash.hash('personal'),
      },
      expect.any(Date),
    );
    expect(f.observe).toHaveBeenCalledTimes(1);
  });
  it('returns a replay before current-contract checks or expiry checks', async () => {
    const f = fixture();
    f.record.payHash = hash.hash(canonicalPay(input()));
    f.record.view.dispatchStatus = 'SUBMITTED';
    f.record.expiresAt = new Date(0);
    const r = await f.start.execute('owner', 'local', input());
    expect(r.isOk()).toBe(true);
    expect(jest.mocked(f.gateway).validateAcceptance).not.toHaveBeenCalled();
    expect(jest.mocked(f.gateway).create).not.toHaveBeenCalled();
  });
  it('blocks a conflicting initiated payload', async () => {
    const f = fixture();
    f.record.payHash = 'other';
    const r = await f.start.execute('o', 'id', input());
    expect(r.isErr() && r.error.kind).toBe('PAYLOAD_CONFLICT');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('commits an expired unsent attempt without sending', async () => {
    const f = fixture();
    f.record.expiresAt = new Date(0);
    const r = await f.start.execute('o', 'id', input());
    expect(r.isErr() && r.error.kind).toBe('RESERVATION_EXPIRED');
    expect(f.record.reservationStatus).toBe('RELEASED');
    expect(f.expire).toHaveBeenCalledTimes(1);
    expect(jest.mocked(f.gateway).create).not.toHaveBeenCalled();
  });
  it('refuses expired/final/unheld attempts without a persisted replay', async () => {
    for (const status of ['EXPIRED', 'APPROVED']) {
      const f = fixture();
      f.record.view.status = status;
      const r = await f.start.execute('o', 'id', input());
      expect(r.isErr() && r.error.kind).toBe(
        status === 'EXPIRED' ? 'RESERVATION_EXPIRED' : 'CHECKOUT_LOCKED',
      );
    }
    const f = fixture();
    f.record.reservationStatus = 'RELEASED';
    expect((await f.start.execute('o', 'id', input())).isErr()).toBe(true);
  });
  it('does not claim when acceptance validation fails', async () => {
    const f = fixture();
    f.gateway.validateAcceptance = () =>
      errAsync({ kind: 'INVALID_ACCEPTANCE' });
    const r = await f.start.execute('o', 'id', input());
    expect(r.isErr() && r.error.kind).toBe('INVALID_ACCEPTANCE');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('retains uncertainty on ambiguous creation and never resends a replay', async () => {
    const f = fixture();
    f.gateway.create = jest.fn(() =>
      errAsync({
        kind: 'GATEWAY_UNAVAILABLE',
        operation: 'creation',
        reason: 'transport',
      }),
    );
    const r = await f.start.execute('o', 'id', input());
    expect(r.isOk() && r.value.dispatchStatus).toBe('UNKNOWN');
    expect(f.record.reservationStatus).toBe('HELD');
    await f.start.execute('o', 'id', input());
    expect(jest.mocked(f.gateway).create).toHaveBeenCalledTimes(1);
  });
  it('preserves durable IN_FLIGHT when persistence fails after sending', async () => {
    const f = fixture();
    const run = f.store.run.bind(f.store);
    let calls = 0;
    f.store.run = (s, id, work) =>
      ++calls === 3
        ? errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' })
        : run(s, id, work);
    const r = await f.start.execute('o', 'id', input());
    expect(r.isErr() && r.error.kind).toBe('PERSISTENCE_UNAVAILABLE');
    expect(f.record.view.dispatchStatus).toBe('IN_FLIGHT');
    await f.start.execute('o', 'id', input());
    expect(jest.mocked(f.gateway).create).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong reference/amount/environment/ID without financial changes', async () => {
    for (const change of [
      { reference: 'foreign' },
      { amountCents: 101 },
      { id: 'other' },
    ]) {
      const f = fixture();
      f.record.providerId = 'remote';
      f.record.view.dispatchStatus = 'SUBMITTED';
      const r = await f.finalizer.execute('o', 'id', {
        ...f.observation,
        ...change,
      });
      expect(r.isErr() && r.error.kind).toBe('OBSERVATION_CONFLICT');
      expect(f.observe).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.record.environment = 'PRODUCTION';
    expect((await f.finalizer.execute('o', 'id', f.observation)).isErr()).toBe(
      true,
    );
  });
  it('applies the same terminal result once and rejects a contradictory terminal result', async () => {
    const f = fixture();
    f.record.view.dispatchStatus = 'IN_FLIGHT';
    await f.finalizer.execute('o', 'id', f.observation);
    await f.finalizer.execute('o', 'id', f.observation);
    expect(f.observe).toHaveBeenCalledTimes(1);
    const conflict = await f.finalizer.execute('o', 'id', {
      ...f.observation,
      status: 'DECLINED',
    });
    expect(conflict.isErr() && conflict.error.kind).toBe(
      'OBSERVATION_CONFLICT',
    );
    expect(
      (
        await f.finalizer.execute('o', 'id', {
          ...f.observation,
          status: 'PENDING',
        })
      ).isOk(),
    ).toBe(true);
  });
  it('does not finalize an unsent observation', async () => {
    const f = fixture();
    expect((await f.finalizer.execute('o', 'id', f.observation)).isErr()).toBe(
      true,
    );
    expect(f.observe).not.toHaveBeenCalled();
  });
  it('returns configuration and synchronizes an identified result', async () => {
    const f = fixture();
    expect((await new GetPaymentConfig(f.gateway).execute()).isOk()).toBe(true);
    f.record.providerId = 'remote';
    f.record.view.dispatchStatus = 'SUBMITTED';
    expect((await f.sync.execute('o', 'id')).isOk()).toBe(true);
    expect(jest.mocked(f.gateway).get).toHaveBeenCalledWith('remote', {
      localId: 'local',
      reference: 'reference',
    });
  });
  it('preserves state/reservation when lookup fails', async () => {
    const f = fixture();
    f.record.providerId = 'remote';
    f.record.view.dispatchStatus = 'SUBMITTED';
    f.gateway.get = () =>
      errAsync({
        kind: 'GATEWAY_UNAVAILABLE',
        operation: 'creation',
        reason: 'http',
      });
    expect((await f.sync.execute('o', 'id')).isErr()).toBe(true);
    expect(f.record.reservationStatus).toBe('HELD');
    expect(f.observe).not.toHaveBeenCalled();
  });
  it('never sends on sync, and marks only old unidentified IN_FLIGHT as UNKNOWN', async () => {
    const f = fixture();
    await f.sync.execute('o', 'id');
    expect(jest.mocked(f.gateway).get).not.toHaveBeenCalled();
    f.record.view.dispatchStatus = 'IN_FLIGHT';
    f.record.startedAt = new Date();
    await f.sync.execute('o', 'id');
    expect(f.unknown).not.toHaveBeenCalled();
    f.record.startedAt = new Date(0);
    await f.sync.execute('o', 'id');
    expect(f.record.view.dispatchStatus).toBe('UNKNOWN');
    expect(jest.mocked(f.gateway).create).not.toHaveBeenCalled();
  });
});
