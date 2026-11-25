import { okAsync, errAsync } from 'neverthrow';
import {
  calculateSummary,
  validatePatch,
  validQuantity,
  CheckoutRecord,
} from './checkout';
import { Money } from '../../shared/domain/money';
import {
  EnsureCheckoutSession,
  AuthenticateSession,
  CreateCheckout,
  GetCheckout,
  UpdateCheckout,
  GetSummary,
} from '../application/checkout-cases';
import type {
  CheckoutStore,
  SessionStore,
  SessionTokens,
} from '../application/checkout-ports';
const buyer = {
  fullName: ' MarÃ­a GÃ³mez ',
  email: 'maria@example.test',
  phone: '+573000000000',
};
const delivery = {
  recipientName: ' MarÃ­a ',
  phone: '+573000000000',
  addressLine1: ' Calle 1 ',
  city: 'BogotÃ¡',
  region: 'BogotÃ¡ D.C.',
  country: 'CO',
};
const record: CheckoutRecord = {
  view: {
    id: 'checkout',
    productId: 'product',
    quantity: 2,
    status: 'DRAFT',
    buyer,
    delivery,
    activeTransactionId: null,
    latestTransactionId: null,
    deliveryId: null,
  },
  unitPriceCents: 12990000,
  currency: 'COP',
  active: true,
  historical: null,
};
function store(value: CheckoutRecord = record): CheckoutStore {
  return {
    get: () => okAsync(value),
    create: () => okAsync(value.view),
    update: () => okAsync(value.view),
  };
}
describe('checkout business rules', () => {
  it('normalizes text without losing accents and retains complete objects', () => {
    const r = validatePatch({ buyer, delivery });
    if (r.isErr()) throw new Error('Invalid fixture');
    expect(r.value.buyer?.fullName).toBe('MarÃ­a GÃ³mez');
    expect(r.value.delivery?.addressLine1).toBe('Calle 1');
  });
  it.each([
    {},
    null,
    [],
    { unknown: 1 },
    { quantity: 0 },
    { quantity: 100 },
    { quantity: 1.5 },
    { quantity: '2' },
    { buyer: { ...buyer, unknown: 1 } },
    { buyer: { ...buyer, email: 'bad' } },
    { delivery: { ...delivery, country: 'US' } },
    { delivery: { ...delivery, city: ' ' } },
    { delivery: { ...delivery, postalCode: 'x'.repeat(13) } },
  ])('rejects invalid draft %p', (input) => {
    expect(validatePatch(input).isErr()).toBe(true);
  });
  it('accepts optional address values and quantity boundaries', () => {
    expect(
      validatePatch({
        quantity: 1,
        delivery: { ...delivery, addressLine2: null, postalCode: ' 123 ' },
      }).isOk(),
    ).toBe(true);
    expect(validQuantity(99)).toBe(true);
  });
  it('calculates fees once per purchase with exact integer arithmetic', () => {
    const r = calculateSummary({
      quantity: 2,
      unitPriceCents: 12990000,
      baseFeeCents: 50000,
      deliveryFeeCents: 100000,
      currency: 'COP',
    });
    if (r.isErr()) throw new Error('Invalid summary');
    expect(r.value).toMatchObject({
      subtotalCents: 25980000,
      totalCents: 26130000,
    });
  });
  it.each([
    { quantity: 99, unitPriceCents: 2000000000 },
    { quantity: 2, unitPriceCents: 0 },
    { quantity: 0, unitPriceCents: 100 },
  ])('rejects invalid/overflow totals %p', (values) => {
    expect(
      calculateSummary({
        ...values,
        baseFeeCents: 50000,
        deliveryFeeCents: 100000,
        currency: 'COP',
      }).isErr(),
    ).toBe(true);
  });
  it('checks Money operations and limits before converting bigint', () => {
    const m = Money.fromCents(2000000000, 'COP');
    if (m.isErr()) throw new Error('Invalid fixture');
    expect(m.value.add(m.value).isErr()).toBe(true);
    expect(m.value.multiply(2).isErr()).toBe(true);
    expect(m.value.multiply(NaN).isErr()).toBe(true);
  });
});
describe('checkout use cases without infrastructure', () => {
  it('creates/reuses sessions with a fixed expiry and never stores bearer', async () => {
    const tokens: SessionTokens = {
      generate: () => 'raw',
      digest: () => 'digest',
      csrf: () => 'csrf',
      verify: () => true,
    };
    const create = jest.fn((digest: string, expiresAt: Date) =>
      okAsync({ id: 'session', expiresAt }),
    );
    const sessions: SessionStore = { find: () => okAsync(null), create };
    const now = new Date('2026-11-25T00:00:00Z');
    const r = await new EnsureCheckoutSession(
      sessions,
      tokens,
      () => now,
    ).execute();
    if (r.isErr()) throw new Error('Unexpected error');
    expect(r.value.session.expiresAt.toISOString()).toBe(
      '2026-11-26T00:00:00.000Z',
    );
    expect(create.mock.calls[0][0]).toBe('digest');
    sessions.find = () => okAsync(r.value.session);
    const again = await new EnsureCheckoutSession(sessions, tokens).execute(
      'raw',
    );
    if (again.isErr()) throw new Error('Unexpected error');
    expect(again.value.created).toBe(false);
    expect(create.mock.calls).toHaveLength(1);
    expect(
      (await new AuthenticateSession(sessions, tokens).execute()).isErr(),
    ).toBe(true);
  });
  it('handles creation, retrieval and business validation through ports', async () => {
    const repository = store();
    expect(
      (await new CreateCheckout(repository).execute('s', 'p', 2)).isOk(),
    ).toBe(true);
    expect(
      (await new CreateCheckout(repository).execute('s', 'p', 0)).isErr(),
    ).toBe(true);
    expect((await new GetCheckout(repository).execute('s', 'id')).isOk()).toBe(
      true,
    );
    expect(
      (
        await new UpdateCheckout(repository).execute('s', 'id', { quantity: 3 })
      ).isOk(),
    ).toBe(true);
    expect(
      (await new UpdateCheckout(repository).execute('s', 'id', {})).isErr(),
    ).toBe(true);
  });
  it('rejects incomplete checkout and preserves typed persistence errors', async () => {
    expect(
      (
        await new GetSummary(
          store({ ...record, view: { ...record.view, buyer: null } }),
        ).execute('s', 'id')
      ).isErr(),
    ).toBe(true);
    const repository = store();
    repository.get = () => errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' });
    const r = await new GetCheckout(repository).execute('s', 'id');
    if (r.isOk()) throw new Error('Expected failure');
    expect(r.error.kind).toBe('PERSISTENCE_UNAVAILABLE');
  });
  it('uses historical amounts even when catalog and status differ', async () => {
    const historical = {
      quantity: 1,
      unitPriceCents: 100,
      baseFeeCents: 5,
      deliveryFeeCents: 10,
      currency: 'COP',
    };
    const r = await new GetSummary(
      store({ ...record, active: false, historical }),
    ).execute('s', 'id');
    if (r.isErr()) throw new Error('Unexpected error');
    expect(r.value.totalCents).toBe(115);
  });
});

describe('session failures and summary boundaries through ports', () => {
  const tokens: SessionTokens = {
    generate: () => 'new',
    digest: () => 'digest',
    csrf: () => 'csrf',
    verify: () => true,
  };
  it('authenticates valid sessions, rejects expired ones and propagates storage failure', async () => {
    const session = { id: 'owner', expiresAt: new Date(Date.now() + 60000) };
    const sessions: SessionStore = {
      find: () => okAsync(session),
      create: () => okAsync(session),
    };
    const valid = await new AuthenticateSession(sessions, tokens).execute(
      'raw',
    );
    expect(valid.isOk() && valid.value.id).toBe('owner');
    sessions.find = () => okAsync(null);
    const expired = await new AuthenticateSession(sessions, tokens).execute(
      'raw',
    );
    expect(expired.isErr() && expired.error.kind).toBe('SESSION_REQUIRED');
    sessions.find = () => errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' });
    const failed = await new EnsureCheckoutSession(sessions, tokens).execute(
      'raw',
    );
    expect(failed.isErr() && failed.error.kind).toBe('PERSISTENCE_UNAVAILABLE');
  });
  it('replaces an expired session instead of extending it', async () => {
    const create = jest.fn((_digest: string, expiresAt: Date) =>
      okAsync({ id: 'new', expiresAt }),
    );
    const result = await new EnsureCheckoutSession(
      { find: () => okAsync(null), create },
      tokens,
      () => new Date('2026-11-25T00:00:00Z'),
    ).execute('expired');
    expect(result.isOk() && result.value.created).toBe(true);
    expect(create.mock.calls[0][1].toISOString()).toBe(
      '2026-11-26T00:00:00.000Z',
    );
  });
  it('calculates a complete draft from current catalog and rejects missing delivery', async () => {
    const result = await new GetSummary(store()).execute('s', 'id');
    expect(result.isOk() && result.value.totalCents).toBe(26130000);
    const incomplete = await new GetSummary(
      store({ ...record, view: { ...record.view, delivery: null } }),
    ).execute('s', 'id');
    expect(incomplete.isErr() && incomplete.error.kind).toBe(
      'INCOMPLETE_CHECKOUT',
    );
  });
  it.each([
    { ...record, active: false },
    { ...record, view: { ...record.view, status: 'PAYMENT_PENDING' } },
  ])(
    'does not quote inactive products or locked purchases without an historical attempt',
    async (value) => {
      const result = await new GetSummary(store(value)).execute('s', 'id');
      expect(result.isErr() && result.error.kind).toBe('CHECKOUT_LOCKED');
    },
  );
});
