import { okAsync, errAsync, ResultAsync } from 'neverthrow';
import type { AttemptContext, TransactionStore } from './transaction-ports';
import type { AttemptView, AttemptDetails } from '../domain/transaction';
import {
  canonicalRequest,
  matchesSummary,
  canExpire,
} from '../domain/transaction';
import {
  CreateTransaction,
  GetTransaction,
  ListTransactions,
} from './transaction-cases';
import { calculateDraftSummary } from '../domain/checkout';
const accepted = {
  quantity: 2,
  unitPriceCents: 12990000,
  baseFeeCents: 50000,
  deliveryFeeCents: 100000,
  currency: 'COP',
};
const now = new Date('2026-11-25T00:00:00Z');
const view: AttemptView = {
  id: 'attempt',
  checkoutId: 'checkout',
  status: 'PENDING',
  dispatchStatus: 'NOT_SENT',
  reservationExpiresAt: new Date(now.getTime() + 600000).toISOString(),
  deliveryId: null,
};
function fixture() {
  const ctx: AttemptContext = {
    checkout: {
      id: 'checkout',
      productId: 'product',
      quantity: 2,
      status: 'DRAFT',
      buyer: {
        fullName: 'Cliente Prueba',
        email: 'buyer@example.test',
        phone: '+573000000000',
      },
      delivery: {
        recipientName: 'Cliente Prueba',
        phone: '+573000000000',
        addressLine1: 'Calle de prueba 1',
        city: 'Bogota',
        region: 'Bogota',
        country: 'CO',
      },
    },
    replay: jest.fn(() => Promise.resolve(null)),
    lockActive: jest.fn(() => Promise.resolve(null)),
    lockProduct: jest.fn(() =>
      Promise.resolve({
        id: 'product',
        name: 'Product',
        description: 'Description',
        active: true,
        unitPriceCents: 12990000,
        currency: 'COP',
        stock: 5,
      }),
    ),
    lockReservation: jest.fn(() =>
      Promise.resolve({
        id: 'reservation',
        status: 'HELD',
        expiresAt: new Date(0),
      }),
    ),
    expire: jest.fn(() => Promise.resolve()),
    available: jest.fn(() => Promise.resolve(5)),
    insert: jest.fn(() => Promise.resolve(view)),
  };
  const details: AttemptDetails = {
    ...view,
    reference: 'reference',
    summary: { ...accepted, subtotalCents: 25980000, totalCents: 26130000 },
    createdAt: now.toISOString(),
    finalizedAt: null,
    reservationExpired: false,
    reservationStatus: 'HELD',
  };
  const get = jest.fn(() => okAsync(details));
  const list = jest.fn(() =>
    okAsync([
      {
        id: details.id,
        checkoutId: details.checkoutId,
        productName: 'Product',
        quantity: details.summary.quantity,
        totalCents: details.summary.totalCents,
        currency: 'COP' as const,
        reference: details.reference,
        status: details.status,
        dispatchStatus: details.dispatchStatus,
        createdAt: details.createdAt,
        deliveryId: details.deliveryId,
      },
    ]),
  );
  const store: TransactionStore = {
    run: (_session, _id, work) =>
      ResultAsync.fromPromise(work(ctx), () => ({
        kind: 'PERSISTENCE_UNAVAILABLE' as const,
      })).andThen((result) => result),
    get,
    list,
  };
  const identity = { hash: jest.fn((s: string) => s) };
  return {
    ctx,
    get,
    list,
    store,
    identity,
    create: new CreateTransaction(store, identity, () => now),
  };
}
describe('transaction use cases and rules without SQL/Nest', () => {
  it('uses server prices/fees and freezes complete data with a ten minute expiry', async () => {
    const f = fixture();
    const result = await f.create.execute(
      'session',
      'CHECKOUT',
      'KEY',
      accepted,
    );
    expect(result.isOk()).toBe(true);
    expect(jest.mocked(f.ctx).insert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'key',
        expiresAt: new Date(now.getTime() + 600000),
        summary: { ...accepted, subtotalCents: 25980000, totalCents: 26130000 },
        buyer: f.ctx.checkout.buyer,
        delivery: f.ctx.checkout.delivery,
      }),
    );
  });
  it('replays identical input before considering current checkout/product state', async () => {
    const f = fixture();
    f.ctx.checkout.status = 'PAID';
    f.ctx.replay = jest.fn(() =>
      Promise.resolve({ hash: canonicalRequest('checkout', accepted), view }),
    );
    const r = await f.create.execute('s', 'CHECKOUT', 'key', accepted);
    expect(r.isOk() && r.value.id).toBe(view.id);
    expect(jest.mocked(f.ctx).lockProduct).not.toHaveBeenCalled();
    expect(jest.mocked(f.ctx).insert).not.toHaveBeenCalled();
  });
  it('rejects conflicting input on the same key without effects', async () => {
    const f = fixture();
    f.ctx.replay = () => Promise.resolve({ hash: 'different', view });
    const r = await f.create.execute('s', 'checkout', 'key', accepted);
    expect(r.isErr() && r.error.kind).toBe('IDEMPOTENCY_CONFLICT');
    expect(jest.mocked(f.ctx).insert).not.toHaveBeenCalled();
  });
  it.each(['PAID', 'PAYMENT_PENDING'])(
    'blocks %s without a replay',
    async (status) => {
      const f = fixture();
      f.ctx.checkout.status = status;
      const r = await f.create.execute('s', 'checkout', 'key', accepted);
      expect(r.isErr() && r.error.kind).toBe('CHECKOUT_LOCKED');
    },
  );
  it.each(['buyer', 'delivery'] as const)(
    'requires complete %s',
    async (key) => {
      const f = fixture();
      f.ctx.checkout[key] = null;
      const r = await f.create.execute('s', 'checkout', 'key', accepted);
      expect(r.isErr() && r.error.kind).toBe('INCOMPLETE_CHECKOUT');
    },
  );
  it.each(['buyer', 'delivery'] as const)(
    'rejects invalid stored %s before creating an attempt',
    async (key) => {
      const f = fixture();
      if (key === 'buyer')
        f.ctx.checkout.buyer = { fullName: 'x', email: 'bad', phone: 'bad' };
      else f.ctx.checkout.delivery = { country: 'US' };
      const r = await f.create.execute('s', 'checkout', 'key', accepted);
      expect(r.isErr() && r.error.kind).toBe(
        key === 'buyer' ? 'INVALID_BUYER' : 'INVALID_DELIVERY',
      );
      expect(jest.mocked(f.ctx).insert).not.toHaveBeenCalled();
    },
  );
  it('rejects inactive product and invalid money without writes', async () => {
    for (const product of [
      { active: false, unitPriceCents: 12990000 },
      { active: true, unitPriceCents: 2000000000 },
    ]) {
      const f = fixture();
      f.ctx.lockProduct = () =>
        Promise.resolve({
          id: 'product',
          name: 'p',
          description: 'd',
          currency: 'COP',
          stock: 5,
          ...product,
        });
      const r = await f.create.execute('s', 'checkout', 'key', accepted);
      expect(r.isErr() && r.error.kind).toBe(
        product.active ? 'INVALID_AMOUNT' : 'PRODUCT_NOT_FOUND',
      );
      expect(jest.mocked(f.ctx).insert).not.toHaveBeenCalled();
    }
  });
  it.each([
    'quantity',
    'unitPriceCents',
    'baseFeeCents',
    'deliveryFeeCents',
    'currency',
  ] as const)('compares accepted %s with server summary', async (field) => {
    const f = fixture();
    const changed = { ...accepted, [field]: field === 'currency' ? 'USD' : 0 };
    const r = await f.create.execute('s', 'checkout', 'key', changed);
    expect(r.isErr() && r.error.kind).toBe('SUMMARY_CHANGED');
    expect(jest.mocked(f.ctx).available).not.toHaveBeenCalled();
  });
  it('rechecks availability inside the locked context', async () => {
    const f = fixture();
    f.ctx.available = () => Promise.resolve(1);
    const r = await f.create.execute('s', 'checkout', 'key', accepted);
    expect(r.isErr() && r.error.kind).toBe('INSUFFICIENT_STOCK');
    expect(jest.mocked(f.ctx).insert).not.toHaveBeenCalled();
  });
  it('expires only its NOT_SENT reservation in documented lock order, then creates a new attempt', async () => {
    const f = fixture();
    f.ctx.checkout.status = 'PAYMENT_PENDING';
    f.ctx.lockActive = jest.fn(() =>
      Promise.resolve({ id: 'old', dispatchStatus: 'NOT_SENT' }),
    );
    const r = await f.create.execute('s', 'checkout', 'key', accepted);
    expect(r.isOk()).toBe(true);
    expect(jest.mocked(f.ctx).expire).toHaveBeenCalledWith(
      { id: 'old', dispatchStatus: 'NOT_SENT' },
      expect.objectContaining({ id: 'reservation' }),
      now,
    );
    const order = [
      jest.mocked(f.ctx).lockActive,
      jest.mocked(f.ctx).lockProduct,
      jest.mocked(f.ctx).lockReservation,
      jest.mocked(f.ctx).expire,
      jest.mocked(f.ctx).available,
      jest.mocked(f.ctx).insert,
    ].map((fn) => (fn as jest.Mock).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('returns a business error after deliberate expiration instead of throwing', async () => {
    const f = fixture();
    f.ctx.checkout.status = 'PAYMENT_PENDING';
    f.ctx.lockActive = () =>
      Promise.resolve({ id: 'old', dispatchStatus: 'NOT_SENT' });
    const r = await f.create.execute('s', 'checkout', 'key', {
      ...accepted,
      baseFeeCents: 0,
    });
    expect(r.isErr() && r.error.kind).toBe('SUMMARY_CHANGED');
    expect(jest.mocked(f.ctx).expire).toHaveBeenCalledTimes(1);
    expect(jest.mocked(f.ctx).insert).not.toHaveBeenCalled();
  });
  it.each(['IN_FLIGHT', 'SUBMITTED', 'UNKNOWN'])(
    'does not expire %s or allow another attempt',
    async (dispatchStatus) => {
      const f = fixture();
      f.ctx.lockActive = () => Promise.resolve({ id: 'old', dispatchStatus });
      const r = await f.create.execute('s', 'checkout', 'key', accepted);
      expect(r.isErr() && r.error.kind).toBe('CHECKOUT_LOCKED');
      expect(jest.mocked(f.ctx).expire).not.toHaveBeenCalled();
    },
  );
  it('propagates typed storage failures and scopes retrieval through its port', async () => {
    const f = fixture();
    f.store.run = () => errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' });
    const r = await f.create.execute('s', 'checkout', 'key', accepted);
    expect(r.isErr() && r.error.kind).toBe('PERSISTENCE_UNAVAILABLE');
    const read = await new GetTransaction(f.store).execute('owner', 'attempt');
    expect(read.isOk()).toBe(true);
    expect(f.get).toHaveBeenCalledWith('owner', 'attempt', expect.any(Date));
    const history = await new ListTransactions(f.store).execute('owner');
    expect(history.isOk() && history.value).toHaveLength(1);
    expect(f.list).toHaveBeenCalledWith('owner');
  });
  it('canonicalizes property order and checkout UUID case, and protects expiry boundaries', () => {
    expect(canonicalRequest('ABCD', accepted)).toBe(
      canonicalRequest('abcd', {
        currency: 'COP',
        deliveryFeeCents: 100000,
        baseFeeCents: 50000,
        unitPriceCents: 12990000,
        quantity: 2,
      }),
    );
    expect(canExpire('NOT_SENT', 'HELD', now, now)).toBe(true);
    expect(
      canExpire('NOT_SENT', 'HELD', new Date(now.getTime() + 1), now),
    ).toBe(false);
    expect(canExpire('NOT_SENT', 'RELEASED', new Date(0), now)).toBe(false);
    const s = calculateDraftSummary(2, 12990000, 'COP');
    expect(s.isOk() && matchesSummary(accepted, s.value)).toBe(true);
  });
});
