import type { DataSource, EntityManager, Repository } from 'typeorm';
import { TypeOrmCheckoutStore, TypeOrmSessionStore } from './checkout.store';
import { CheckoutOrmEntity } from './checkout.entity';
import { CheckoutSessionOrmEntity } from './checkout-session.entity';
import { CustomerOrmEntity } from './customer.entity';
import { TransactionOrmEntity } from './transaction.entity';
import { ProductOrmEntity } from '../../../catalog/infrastructure/typeorm/product.entity';
import { DeliveryOrmEntity } from '../../../fulfillment/infrastructure/typeorm/delivery.entity';

const owner = 'session-test';
const checkoutId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const buyer = {
  fullName: 'Cliente Ficticio',
  email: 'buyer@example.test',
  phone: '+573000000000',
};
const delivery = {
  recipientName: 'Cliente Ficticio',
  phone: '+573000000000',
  addressLine1: 'Calle ficticia 123',
  city: 'Bogotá',
  region: 'Bogotá',
  country: 'CO',
};
const draft = (changes: Partial<CheckoutOrmEntity> = {}) =>
  Object.assign(
    new CheckoutOrmEntity(),
    {
      id: checkoutId,
      sessionId: owner,
      productId,
      quantity: 2,
      status: 'DRAFT',
      customerId: null,
      deliveryDraft: null,
    },
    changes,
  );
const product = () =>
  Object.assign(new ProductOrmEntity(), {
    id: productId,
    unitPriceCents: 12000,
    currency: 'COP',
    active: true,
  });

function unexpected(): never {
  throw new Error('Unexpected persistence call');
}

// Only the adapter-facing boundary is simulated. PostgreSQL owns commit/rollback.
function fixture() {
  const findOneBy = jest
    .fn<Promise<unknown>, unknown[]>()
    .mockImplementation(unexpected);
  const findOne = jest
    .fn<Promise<unknown>, unknown[]>()
    .mockImplementation(unexpected);
  const findOneByOrFail = jest
    .fn<Promise<unknown>, unknown[]>()
    .mockImplementation(unexpected);
  const find = jest
    .fn<Promise<unknown>, unknown[]>()
    .mockImplementation(unexpected);
  const save = jest
    .fn<Promise<unknown>, unknown[]>()
    .mockImplementation(unexpected);
  const methods = { findOneBy, findOne, findOneByOrFail, find, save };
  const manager = new Proxy(methods, {
    get(target, key: keyof typeof methods) {
      if (!(key in target)) unexpected();
      return target[key];
    },
  }) as unknown as EntityManager;
  const transaction = jest
    .fn<Promise<unknown>, [(m: EntityManager) => Promise<unknown>]>()
    .mockImplementationOnce((work) => work(manager));
  const db = new Proxy(
    { transaction },
    {
      get(target, key: 'transaction') {
        if (!(key in target)) unexpected();
        return target[key];
      },
    },
  ) as unknown as DataSource;
  return { store: new TypeOrmCheckoutStore(db), transaction, ...methods };
}

function readFixture(
  f: ReturnType<typeof fixture>,
  attempts: TransactionOrmEntity[] = [],
  customer: CustomerOrmEntity | null = null,
  delivered = false,
) {
  f.findOneByOrFail.mockResolvedValueOnce(product());
  if (customer) f.findOneByOrFail.mockResolvedValueOnce(customer);
  f.find.mockResolvedValueOnce(attempts);
  f.findOneBy.mockResolvedValueOnce(delivered ? { id: 'delivery-test' } : null);
}

describe('TypeOrmSessionStore', () => {
  function fixture() {
    const findOneBy = jest
      .fn<
        ReturnType<Repository<CheckoutSessionOrmEntity>['findOneBy']>,
        Parameters<Repository<CheckoutSessionOrmEntity>['findOneBy']>
      >()
      .mockImplementation(unexpected);
    const save = jest
      .fn<
        Promise<CheckoutSessionOrmEntity>,
        [Partial<CheckoutSessionOrmEntity>]
      >()
      .mockImplementation(unexpected);
    const getRepository = jest
      .fn<unknown, [typeof CheckoutSessionOrmEntity]>()
      .mockReturnValueOnce({ findOneBy, save });
    const store = new TypeOrmSessionStore({
      getRepository,
    } as unknown as DataSource);
    return { store, getRepository, findOneBy, save };
  }
  const digest = 'ab'.repeat(32);
  const now = new Date('2030-01-01T00:00:00Z');
  const expiresAt = new Date('2030-01-02T00:00:00Z');

  it('stores only the digest and returns the public session projection', async () => {
    const f = fixture();
    f.save.mockImplementationOnce((input) =>
      Promise.resolve(Object.assign(new CheckoutSessionOrmEntity(), input)),
    );
    const result = await f.store.create(digest, expiresAt);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error('Expected session');
    expect(result.value.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.value).toEqual({ id: result.value.id, expiresAt });
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledWith({
      id: result.value.id,
      tokenDigest: Buffer.from(digest, 'hex'),
      expiresAt,
    });
    expect(f.getRepository).toHaveBeenCalledTimes(1);
    expect(f.getRepository).toHaveBeenCalledWith(CheckoutSessionOrmEntity);
    expect(f.findOneBy).not.toHaveBeenCalled();
  });

  it.each(['valid', 'expired', 'boundary', 'missing'] as const)(
    'reads %s session by its digest',
    async (state) => {
      const f = fixture();
      f.findOneBy.mockResolvedValueOnce(
        state === 'missing'
          ? null
          : Object.assign(new CheckoutSessionOrmEntity(), {
              id: owner,
              expiresAt:
                state === 'valid'
                  ? expiresAt
                  : state === 'boundary'
                    ? now
                    : new Date(0),
            }),
      );
      const result = await f.store.find(digest, now);
      expect(result.isOk() && result.value).toEqual(
        state === 'valid' ? { id: owner, expiresAt } : null,
      );
      expect(f.findOneBy).toHaveBeenCalledTimes(1);
      expect(f.findOneBy).toHaveBeenCalledWith({
        tokenDigest: Buffer.from(digest, 'hex'),
      });
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'find'] as const)(
    'translates persistence failure on %s',
    async (operation) => {
      const f = fixture();
      if (operation === 'create')
        f.save.mockRejectedValueOnce(new Error('private SQL'));
      else f.findOneBy.mockRejectedValueOnce(new Error('private SQL'));
      const result = await (operation === 'create'
        ? f.store.create(digest, expiresAt)
        : f.store.find(digest, now));
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
    },
  );
});

describe('TypeOrmCheckoutStore', () => {
  it('creates a DRAFT for the selected owner, product and quantity in one transaction', async () => {
    const f = fixture();
    f.findOneBy.mockResolvedValueOnce(product());
    f.save.mockImplementationOnce((_entity, input) =>
      Promise.resolve(draft(input as Partial<CheckoutOrmEntity>)),
    );
    readFixture(f);
    const result = await f.store.create(owner, productId, 2);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error('Expected draft');
    expect(result.value).toEqual({
      id: result.value.id,
      productId,
      quantity: 2,
      status: 'DRAFT',
      buyer: null,
      delivery: null,
      activeTransactionId: null,
      latestTransactionId: null,
      deliveryId: null,
    });
    expect(f.findOneBy).toHaveBeenNthCalledWith(1, ProductOrmEntity, {
      id: productId,
      active: true,
    });
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledWith(CheckoutOrmEntity, {
      id: result.value.id,
      sessionId: owner,
      productId,
      quantity: 2,
      status: 'DRAFT',
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns PRODUCT_NOT_FOUND without writes when the selected active product is absent', async () => {
    const f = fixture();
    f.findOneBy.mockResolvedValueOnce(null);
    const result = await f.store.create(owner, productId, 2);
    expect(result.isErr() && result.error).toEqual({
      kind: 'PRODUCT_NOT_FOUND',
    });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.find).not.toHaveBeenCalled();
  });

  it('reads the owner-scoped checkout and server catalog values without writing', async () => {
    const f = fixture();
    f.findOneBy.mockResolvedValueOnce(draft());
    readFixture(f);
    const result = await f.store.get(owner, checkoutId);
    expect(result.isOk() && result.value).toEqual({
      view: {
        id: checkoutId,
        productId,
        quantity: 2,
        status: 'DRAFT',
        buyer: null,
        delivery: null,
        activeTransactionId: null,
        latestTransactionId: null,
        deliveryId: null,
      },
      unitPriceCents: 12000,
      currency: 'COP',
      active: true,
      historical: null,
    });
    expect(f.findOneBy).toHaveBeenNthCalledWith(1, CheckoutOrmEntity, {
      id: checkoutId,
      sessionId: owner,
    });
    expect(f.findOneByOrFail).toHaveBeenCalledWith(ProductOrmEntity, {
      id: productId,
    });
    expect(f.find).toHaveBeenCalledWith(TransactionOrmEntity, {
      where: { checkoutId },
      order: { createdAt: 'DESC', attemptNumber: 'DESC' },
    });
    expect(f.findOneBy).toHaveBeenNthCalledWith(2, DeliveryOrmEntity, {
      checkoutId,
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each([owner, 'other-session'])(
    'maps an absent owner-scoped row to RESOURCE_NOT_FOUND for %s',
    async (sessionId) => {
      const f = fixture();
      f.findOneBy.mockResolvedValueOnce(null);
      const result = await f.store.get(sessionId, checkoutId);
      expect(result.isErr() && result.error).toEqual({
        kind: 'RESOURCE_NOT_FOUND',
      });
      expect(f.findOneBy).toHaveBeenCalledTimes(1);
      expect(f.findOneBy).toHaveBeenCalledWith(CheckoutOrmEntity, {
        id: checkoutId,
        sessionId,
      });
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'selects historical amounts with approval present=%s',
    async (approved) => {
      const f = fixture();
      f.findOneBy.mockResolvedValueOnce(
        draft({ customerId: 'customer-test', deliveryDraft: delivery }),
      );
      const pending = Object.assign(new TransactionOrmEntity(), {
        id: 'pending-test',
        status: 'PENDING',
        quantity: 3,
        unitPriceCents: 10000,
        baseFeeCents: 50,
        deliveryFeeCents: 100,
        currency: 'COP',
      });
      const paid = Object.assign(new TransactionOrmEntity(), {
        ...pending,
        id: 'approved-test',
        status: 'APPROVED',
        quantity: 1,
        unitPriceCents: 9000,
      });
      const rejected = Object.assign(new TransactionOrmEntity(), {
        id: 'latest-test',
        status: 'DECLINED',
      });
      readFixture(
        f,
        approved ? [rejected, pending, paid] : [rejected, pending],
        Object.assign(new CustomerOrmEntity(), {
          id: 'customer-test',
          ...buyer,
        }),
        true,
      );
      const result = await f.store.get(owner, checkoutId);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) throw new Error('Expected checkout');
      expect(result.value.view).toMatchObject({
        buyer,
        delivery,
        activeTransactionId: pending.id,
        latestTransactionId: rejected.id,
        deliveryId: 'delivery-test',
      });
      expect(result.value.historical).toEqual({
        quantity: approved ? 1 : 3,
        unitPriceCents: approved ? 9000 : 10000,
        baseFeeCents: 50,
        deliveryFeeCents: 100,
        currency: 'COP',
      });
      expect(result.value.unitPriceCents).toBe(12000);
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it.each([null, 'existing-customer'])(
    'updates buyer, delivery and quantity under a write lock with customer=%s',
    async (customerId) => {
      const f = fixture();
      const row = draft({ customerId });
      f.findOne.mockResolvedValueOnce(row);
      f.save.mockImplementationOnce((_entity, input) =>
        Promise.resolve(Object.assign(new CustomerOrmEntity(), input)),
      );
      f.save.mockResolvedValueOnce(row);
      readFixture(f, [], Object.assign(new CustomerOrmEntity(), buyer));
      const result = await f.store.update(owner, checkoutId, {
        buyer,
        delivery,
        quantity: 4,
      });
      expect(result.isOk() && result.value).toMatchObject({
        quantity: 4,
        buyer,
        delivery,
      });
      expect(f.findOne).toHaveBeenCalledTimes(1);
      expect(f.findOne).toHaveBeenCalledWith(CheckoutOrmEntity, {
        where: { id: checkoutId, sessionId: owner },
        lock: { mode: 'pessimistic_write' },
      });
      expect(f.save).toHaveBeenCalledTimes(2);
      expect(f.save).toHaveBeenNthCalledWith(1, CustomerOrmEntity, {
        id: row.customerId,
        ...buyer,
      });
      if (customerId) expect(row.customerId).toBe(customerId);
      else expect(row.customerId).toMatch(/^[0-9a-f-]{36}$/);
      expect(f.save).toHaveBeenNthCalledWith(2, row);
      expect(row.productId).toBe(productId);
      expect(f.transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps buyer, delivery and quantity when an unrelated empty patch reaches the store', async () => {
    const f = fixture();
    const row = draft();
    f.findOne.mockResolvedValueOnce(row);
    f.save.mockResolvedValueOnce(row);
    readFixture(f);
    const result = await f.store.update(owner, checkoutId, {});
    expect(result.isOk() && result.value).toMatchObject({
      quantity: 2,
      buyer: null,
      delivery: null,
    });
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledWith(row);
  });

  it.each(['missing', 'PAYMENT_PENDING', 'PAID'])(
    'refuses update for %s without writes',
    async (status) => {
      const f = fixture();
      f.findOne.mockResolvedValueOnce(
        status === 'missing' ? null : Object.assign(draft(), { status }),
      );
      const result = await f.store.update(owner, checkoutId, { quantity: 3 });
      expect(result.isErr() && result.error).toEqual({
        kind: status === 'missing' ? 'RESOURCE_NOT_FOUND' : 'CHECKOUT_LOCKED',
      });
      expect(f.save).not.toHaveBeenCalled();
      expect(f.find).not.toHaveBeenCalled();
    },
  );

  it.each(['lookup', 'customer', 'checkout', 'readback'] as const)(
    'propagates SQL rejection out of the transaction callback at %s',
    async (stage) => {
      const f = fixture();
      const row = draft();
      if (stage === 'lookup')
        f.findOne.mockRejectedValueOnce(new Error('private lookup'));
      else {
        f.findOne.mockResolvedValueOnce(row);
        if (stage === 'customer')
          f.save.mockRejectedValueOnce(new Error('private customer'));
        else {
          f.save.mockResolvedValueOnce({ id: 'customer-test' });
          if (stage === 'checkout')
            f.save.mockRejectedValueOnce(new Error('private checkout'));
          else {
            f.save.mockResolvedValueOnce(row);
            f.findOneByOrFail.mockRejectedValueOnce(
              new Error('private readback'),
            );
          }
        }
      }
      const result = await f.store.update(owner, checkoutId, {
        buyer,
        delivery,
        quantity: 4,
      });
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(f.transaction).toHaveBeenCalledTimes(1);
      await expect(f.transaction.mock.results[0].value).rejects.toThrow(
        /private/,
      );
      expect(f.save).toHaveBeenCalledTimes(
        stage === 'lookup' ? 0 : stage === 'customer' ? 1 : 2,
      );
      expect(f.find).not.toHaveBeenCalled();
      expect(f.findOneBy).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'get'] as const)(
    'translates transaction startup rejection for %s',
    async (operation) => {
      const f = fixture();
      f.transaction
        .mockReset()
        .mockRejectedValueOnce(new Error('private connection'));
      const result = await (operation === 'create'
        ? f.store.create(owner, productId, 2)
        : f.store.get(owner, checkoutId));
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(f.save).not.toHaveBeenCalled();
      expect(f.findOneBy).not.toHaveBeenCalled();
    },
  );
});
