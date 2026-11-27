import { Logger } from '@nestjs/common';
import { ok } from 'neverthrow';
import type { DataSource, EntityManager } from 'typeorm';
import { TypeOrmTransactionStore } from './transaction.store';
import { CheckoutOrmEntity } from './checkout.entity';
import { TransactionOrmEntity } from './transaction.entity';
import { ProductOrmEntity } from '../../../catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../../../catalog/infrastructure/typeorm/inventory-reservation.entity';
import type { AttemptWrite } from '../../application/transaction-ports';

const owner = 'session-test';
const checkoutId = 'checkout-test';
const now = new Date('2030-01-01T00:00:00Z');
const expiresAt = new Date('2030-01-01T00:10:00Z');
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
const checkout = (customerId: string | null = null) =>
  Object.assign(new CheckoutOrmEntity(), {
    id: checkoutId,
    sessionId: owner,
    productId: 'product-test',
    quantity: 2,
    status: 'DRAFT',
    customerId,
    deliveryDraft: delivery,
  });
const attempt = (changes: Partial<TransactionOrmEntity> = {}) =>
  Object.assign(new TransactionOrmEntity(), {
    id: 'attempt-test',
    checkoutId,
    productId: 'product-test',
    productName: 'Producto histórico',
    quantity: 2,
    unitPriceCents: 10000,
    baseFeeCents: 500,
    deliveryFeeCents: 1000,
    currency: 'COP',
    reference: 'pc_test',
    status: 'PENDING',
    dispatchStatus: 'NOT_SENT',
    createRequestHash: 'hash-test',
    createdAt: now,
    finalizedAt: null,
    ...changes,
  });
const reservation = () =>
  Object.assign(new InventoryReservationOrmEntity(), {
    id: 'reservation-test',
    transactionId: 'attempt-test',
    status: 'HELD',
    expiresAt,
  });
const input: AttemptWrite = {
  product: {
    id: 'product-test',
    name: 'Producto histórico',
    description: 'Descripción ficticia',
    active: true,
    unitPriceCents: 10000,
    currency: 'COP',
    stock: 10,
  },
  buyer,
  delivery,
  summary: {
    quantity: 2,
    unitPriceCents: 10000,
    subtotalCents: 20000,
    baseFeeCents: 500,
    deliveryFeeCents: 1000,
    totalCents: 21500,
    currency: 'COP',
  },
  key: 'key-test',
  hash: 'hash-test',
  expiresAt,
};
function publicView() {
  return {
    id: 'attempt-test',
    checkoutId,
    status: 'PENDING',
    dispatchStatus: 'NOT_SENT',
    reservationExpiresAt: expiresAt.toISOString(),
    deliveryId: null,
  };
}
function unexpected(): never {
  throw new Error('Unexpected persistence call');
}

function fixture() {
  const query = {
    innerJoin: jest.fn<unknown, unknown[]>(),
    leftJoin: jest.fn<unknown, unknown[]>(),
    select: jest.fn<unknown, unknown[]>(),
    addSelect: jest.fn<unknown, unknown[]>(),
    where: jest.fn<unknown, unknown[]>(),
    andWhere: jest.fn<unknown, unknown[]>(),
    orderBy: jest.fn<unknown, unknown[]>(),
    addOrderBy: jest.fn<unknown, unknown[]>(),
    getOne: jest
      .fn<Promise<TransactionOrmEntity | null>, []>()
      .mockImplementation(unexpected),
    getRawOne: jest
      .fn<Promise<{ held: string } | undefined>, []>()
      .mockImplementation(unexpected),
    getRawMany: jest
      .fn<Promise<unknown[]>, []>()
      .mockImplementation(unexpected),
  };
  const builder = new Proxy(query, {
    get(target, key: keyof typeof query) {
      if (!(key in target)) unexpected();
      return target[key];
    },
  });
  for (const method of [
    query.innerJoin,
    query.leftJoin,
    query.select,
    query.addSelect,
    query.where,
    query.andWhere,
    query.orderBy,
    query.addOrderBy,
  ])
    method.mockReturnValue(builder);
  const methods = {
    findOne: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    findOneBy: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    findOneByOrFail: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    findOneOrFail: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    save: jest.fn<Promise<unknown>, unknown[]>().mockImplementation(unexpected),
    update: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    createQueryBuilder: jest
      .fn<unknown, unknown[]>()
      .mockReturnValueOnce(builder),
  };
  const manager = new Proxy(methods, {
    get(target, key: keyof typeof methods) {
      if (!(key in target)) unexpected();
      return target[key];
    },
  }) as unknown as EntityManager;
  type Work = (manager: EntityManager) => Promise<unknown>;
  const transaction = jest
    .fn<Promise<unknown>, [Work | string, Work?]>()
    .mockImplementationOnce((isolationOrWork, work) =>
      typeof isolationOrWork === 'function'
        ? isolationOrWork(manager)
        : work
          ? work(manager)
          : Promise.reject(new Error('Missing callback')),
    );
  return {
    store: new TypeOrmTransactionStore({
      transaction,
    } as unknown as DataSource),
    transaction,
    query,
    ...methods,
  };
}

describe('TypeOrmTransactionStore', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([null, 'customer-test'])(
    'maps the locked owner checkout with customer=%s',
    async (customerId) => {
      const f = fixture();
      f.findOne.mockResolvedValueOnce(checkout(customerId));
      if (customerId) f.findOneByOrFail.mockResolvedValueOnce(buyer);
      const result = await f.store.run(owner, checkoutId, (ctx) => {
        expect(ctx.checkout).toEqual({
          id: checkoutId,
          productId: 'product-test',
          quantity: 2,
          status: 'DRAFT',
          buyer: customerId ? buyer : null,
          delivery,
        });
        return Promise.resolve(ok(publicView()));
      });
      expect(result.isOk()).toBe(true);
      expect(f.findOne).toHaveBeenCalledWith(CheckoutOrmEntity, {
        where: { id: checkoutId, sessionId: owner },
        lock: { mode: 'pessimistic_write' },
      });
      expect(f.findOne).toHaveBeenCalledTimes(1);
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('does not invoke work for a missing owner-scoped checkout', async () => {
    const f = fixture();
    f.findOne.mockResolvedValueOnce(null);
    const work = jest.fn().mockImplementation(unexpected);
    const result = await f.store.run(owner, checkoutId, work);
    expect(result.isErr() && result.error).toEqual({
      kind: 'RESOURCE_NOT_FOUND',
    });
    expect(work).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'reads an idempotency replay with existing=%s without inserting',
    async (existing) => {
      const f = fixture();
      f.findOne.mockResolvedValueOnce(checkout());
      f.findOneBy.mockResolvedValueOnce(existing ? attempt() : null);
      if (existing) {
        f.findOneByOrFail.mockResolvedValueOnce(reservation());
        f.findOneBy.mockResolvedValueOnce({ id: 'delivery-test' });
      }
      const result = await f.store.run(owner, checkoutId, async (ctx) => {
        const replay = await ctx.replay('key-test');
        expect(replay).toEqual(
          existing
            ? {
                hash: 'hash-test',
                view: {
                  id: 'attempt-test',
                  checkoutId,
                  status: 'PENDING',
                  dispatchStatus: 'NOT_SENT',
                  reservationExpiresAt: expiresAt.toISOString(),
                  deliveryId: 'delivery-test',
                },
              }
            : null,
        );
        return ok(publicView());
      });
      expect(result.isOk()).toBe(true);
      expect(f.findOneBy).toHaveBeenNthCalledWith(1, TransactionOrmEntity, {
        checkoutId,
        idempotencyKey: 'key-test',
      });
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('exposes active attempt, product and reservation through explicit write locks', async () => {
    const f = fixture();
    f.findOne
      .mockResolvedValueOnce(checkout())
      .mockResolvedValueOnce(attempt());
    f.findOneOrFail
      .mockResolvedValueOnce(input.product)
      .mockResolvedValueOnce(reservation());
    const result = await f.store.run(owner, checkoutId, async (ctx) => {
      expect(await ctx.lockActive()).toMatchObject({
        id: 'attempt-test',
        status: 'PENDING',
      });
      expect(await ctx.lockProduct()).toEqual(input.product);
      expect(await ctx.lockReservation('attempt-test')).toEqual(reservation());
      return ok(publicView());
    });
    expect(result.isOk()).toBe(true);
    expect(f.findOne).toHaveBeenNthCalledWith(2, TransactionOrmEntity, {
      where: { checkoutId, status: 'PENDING' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(f.findOneOrFail).toHaveBeenNthCalledWith(1, ProductOrmEntity, {
      where: { id: 'product-test' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(f.findOneOrFail).toHaveBeenNthCalledWith(
      2,
      InventoryReservationOrmEntity,
      {
        where: { transactionId: 'attempt-test' },
        lock: { mode: 'pessimistic_write' },
      },
    );
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['3', undefined])(
    'calculates availability from the aggregate %s and server stock',
    async (held) => {
      const f = fixture();
      f.findOne.mockResolvedValueOnce(checkout());
      f.query.getRawOne.mockResolvedValueOnce(
        held === undefined ? undefined : { held },
      );
      f.findOneByOrFail.mockResolvedValueOnce({ stock: 10 });
      const result = await f.store.run(owner, checkoutId, async (ctx) => {
        expect(await ctx.available(now)).toBe(held ? 7 : 10);
        return ok(publicView());
      });
      expect(result.isOk()).toBe(true);
      expect(f.query.where).toHaveBeenCalledWith('r.product_id = :id', {
        id: 'product-test',
      });
      expect(f.query.andWhere).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('HELD'),
      );
      expect(f.query.andWhere).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(':now'),
        { now },
      );
      expect(f.query.getRawOne).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, 2])(
    'inserts PENDING and HELD with historical snapshots after attempt number %s',
    async (latest) => {
      const f = fixture();
      f.findOne
        .mockResolvedValueOnce(checkout())
        .mockResolvedValueOnce(
          latest === null ? null : { attemptNumber: latest },
        );
      f.save
        .mockImplementationOnce((_entity, values) =>
          Promise.resolve(Object.assign(attempt(), values)),
        )
        .mockResolvedValueOnce(reservation());
      f.update.mockResolvedValueOnce({ affected: 1 });
      f.findOneByOrFail.mockResolvedValueOnce(reservation());
      f.findOneBy.mockResolvedValueOnce(null);
      const result = await f.store.run(owner, checkoutId, (ctx) =>
        ctx.insert(input).then((value) => ok(value)),
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) throw new Error('Expected created attempt');
      const saved = f.save.mock.calls[0][1] as TransactionOrmEntity;
      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved.reference).toMatch(/^pc_[0-9a-f]{32}$/);
      expect(saved).toMatchObject({
        checkoutId,
        productId: 'product-test',
        attemptNumber: latest === null ? 1 : 3,
        idempotencyKey: input.key,
        createRequestHash: input.hash,
        status: 'PENDING',
        dispatchStatus: 'NOT_SENT',
        productName: input.product.name,
        productDescription: input.product.description,
        quantity: 2,
        unitPriceCents: 10000,
        baseFeeCents: 500,
        deliveryFeeCents: 1000,
        currency: 'COP',
        buyerSnapshot: buyer,
        deliverySnapshot: delivery,
      });
      expect(saved.buyerSnapshot).not.toBe(buyer);
      expect(saved.deliverySnapshot).not.toBe(delivery);
      expect(result.value.id).toBe(saved.id);
      expect(f.save).toHaveBeenCalledTimes(2);
      expect(f.save).toHaveBeenNthCalledWith(2, InventoryReservationOrmEntity, {
        id: expect.any(String) as unknown,
        transactionId: saved.id,
        productId: 'product-test',
        quantity: 2,
        status: 'HELD',
        expiresAt,
      });
      expect(f.update).toHaveBeenCalledWith(CheckoutOrmEntity, checkoutId, {
        status: 'PAYMENT_PENDING',
      });
      expect(f.transaction).toHaveBeenCalledTimes(1);
      expect(f.save.mock.invocationCallOrder[1]).toBeLessThan(
        f.update.mock.invocationCallOrder[0],
      );
    },
  );

  it('writes deliberate expiration and release inside the callback', async () => {
    const f = fixture();
    f.findOne.mockResolvedValueOnce(checkout());
    f.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const result = await f.store.run(owner, checkoutId, async (ctx) => {
      await ctx.expire(attempt(), reservation(), now);
      return ok(publicView());
    });
    expect(result.isOk()).toBe(true);
    expect(f.update.mock.calls).toEqual([
      [
        TransactionOrmEntity,
        'attempt-test',
        { status: 'EXPIRED', finalizedAt: now },
      ],
      [
        InventoryReservationOrmEntity,
        'reservation-test',
        { status: 'RELEASED' },
      ],
      [CheckoutOrmEntity, checkoutId, { status: 'DRAFT' }],
    ]);
  });

  it('stops after reservation insertion failure and propagates callback rejection', async () => {
    const f = fixture();
    f.findOne.mockResolvedValueOnce(checkout()).mockResolvedValueOnce(null);
    f.save
      .mockResolvedValueOnce(attempt())
      .mockRejectedValueOnce(new Error('reservation SQL failed'));
    const result = await f.store.run(owner, checkoutId, (ctx) =>
      ctx.insert(input).then((value) => ok(value)),
    );
    expect(result.isErr() && result.error).toEqual({
      kind: 'PERSISTENCE_UNAVAILABLE',
    });
    await expect(f.transaction.mock.results[0].value).rejects.toThrow(
      'reservation SQL failed',
    );
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.update).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['NOT_SENT', 'SUBMITTED'])(
    'maps owned detail with dispatch %s and frozen amounts',
    async (dispatchStatus) => {
      const f = fixture();
      f.query.getOne.mockResolvedValueOnce(
        attempt({
          dispatchStatus:
            dispatchStatus as TransactionOrmEntity['dispatchStatus'],
          finalizedAt: dispatchStatus === 'SUBMITTED' ? now : null,
        }),
      );
      f.findOneByOrFail
        .mockResolvedValueOnce(reservation())
        .mockResolvedValueOnce(reservation());
      f.findOneBy.mockResolvedValueOnce(null);
      const result = await f.store.get(owner, 'attempt-test', expiresAt);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) throw new Error('Expected detail');
      expect(result.value).toEqual({
        id: 'attempt-test',
        checkoutId,
        status: 'PENDING',
        dispatchStatus,
        reference: 'pc_test',
        summary: input.summary,
        createdAt: now.toISOString(),
        finalizedAt: dispatchStatus === 'SUBMITTED' ? now.toISOString() : null,
        reservationStatus: 'HELD',
        reservationExpired: dispatchStatus === 'NOT_SENT',
        reservationExpiresAt: expiresAt.toISOString(),
        deliveryId: null,
      });
      expect(f.query.where).toHaveBeenCalledWith(
        't.id = :id AND c.session_id = :sessionId',
        { id: 'attempt-test', sessionId: owner },
      );
      expect(f.transaction).toHaveBeenCalledWith(
        'REPEATABLE READ',
        expect.any(Function),
      );
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('returns RESOURCE_NOT_FOUND when the owned detail query is empty', async () => {
    const f = fixture();
    f.query.getOne.mockResolvedValueOnce(null);
    const result = await f.store.get(owner, 'absent', now);
    expect(result.isErr() && result.error).toEqual({
      kind: 'RESOURCE_NOT_FOUND',
    });
    expect(f.findOneByOrFail).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'lists owner history with empty=%s and stable SQL ordering',
    async (empty) => {
      const f = fixture();
      f.query.getRawMany.mockResolvedValueOnce(
        empty
          ? []
          : [{ ...attempt(), deliveryId: 'delivery-test', quantity: '2' }],
      );
      const result = await f.store.list(owner);
      expect(result.isOk() && result.value).toEqual(
        empty
          ? []
          : [
              {
                id: 'attempt-test',
                checkoutId,
                productName: 'Producto histórico',
                quantity: 2,
                totalCents: 21500,
                currency: 'COP',
                reference: 'pc_test',
                status: 'PENDING',
                dispatchStatus: 'NOT_SENT',
                createdAt: now.toISOString(),
                deliveryId: 'delivery-test',
              },
            ],
      );
      expect(f.query.where).toHaveBeenCalledWith('c.session_id = :sessionId', {
        sessionId: owner,
      });
      expect(f.query.orderBy).toHaveBeenCalledWith('t.created_at', 'DESC');
      expect(f.query.addOrderBy).toHaveBeenCalledWith('t.id', 'DESC');
      expect(f.query.getRawMany).toHaveBeenCalledTimes(1);
      expect(f.save).not.toHaveBeenCalled();
      expect(f.query.addSelect.mock.calls.flat()).not.toContain(
        't.buyer_snapshot',
      );
    },
  );

  it.each(['get', 'list'] as const)(
    'rejects invalid persisted historical amounts on %s',
    async (operation) => {
      const f = fixture();
      if (operation === 'get') {
        f.query.getOne.mockResolvedValueOnce(attempt({ unitPriceCents: -1 }));
        f.findOneByOrFail.mockResolvedValueOnce(reservation());
      } else
        f.query.getRawMany.mockResolvedValueOnce([
          attempt({ unitPriceCents: -1 }),
        ]);
      const result = await (operation === 'get'
        ? f.store.get(owner, 'attempt-test', now)
        : f.store.list(owner));
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it.each(['run', 'get', 'list'] as const)(
    'translates transaction failure on %s',
    async (operation) => {
      const f = fixture();
      f.transaction.mockReset().mockRejectedValueOnce(new Error('private SQL'));
      const result = await (operation === 'run'
        ? f.store.run(owner, checkoutId, () =>
            Promise.resolve(ok(publicView())),
          )
        : operation === 'get'
          ? f.store.get(owner, 'attempt-test', now)
          : f.store.list(owner));
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(f.save).not.toHaveBeenCalled();
    },
  );
});
