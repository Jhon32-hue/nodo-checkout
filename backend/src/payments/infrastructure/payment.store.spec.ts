import { Logger } from '@nestjs/common';
import { ok, okAsync } from 'neverthrow';
import type { DataSource, EntityManager } from 'typeorm';
import { TypeOrmPaymentStore } from './payment.store';
import { TransactionOrmEntity } from '../../checkout/infrastructure/typeorm/transaction.entity';
import { CheckoutOrmEntity } from '../../checkout/infrastructure/typeorm/checkout.entity';
import { ProductOrmEntity } from '../../catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../../catalog/infrastructure/typeorm/inventory-reservation.entity';
import { DeliveryOrmEntity } from '../../fulfillment/infrastructure/typeorm/delivery.entity';
import {
  FinalizePayment,
  StartPayment,
  SyncPayment,
} from '../application/payment-cases';
import type { PaymentGateway } from '../application/payment-ports';
import type { Observation, PayInput } from '../domain/payment';

const owner = 'session-test',
  id = 'attempt-test',
  checkoutId = 'checkout-test';
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
const attempt = (changes: Partial<TransactionOrmEntity> = {}) =>
  Object.assign(new TransactionOrmEntity(), {
    id,
    checkoutId,
    productId: 'product-test',
    reference: 'pc_test',
    quantity: 2,
    unitPriceCents: 10000,
    baseFeeCents: 500,
    deliveryFeeCents: 1000,
    currency: 'COP',
    status: 'PENDING',
    dispatchStatus: 'IN_FLIGHT',
    providerEnvironment: 'UAT_SANDBOX',
    providerTransactionId: null,
    payRequestHash: null,
    submissionStartedAt: now,
    buyerSnapshot: buyer,
    deliverySnapshot: delivery,
    ...changes,
  });
const reservation = (status = 'HELD') =>
  Object.assign(new InventoryReservationOrmEntity(), {
    id: 'reservation-test',
    transactionId: id,
    status,
    expiresAt,
  });
const observation = (
  status: Observation['status'] = 'APPROVED',
): Observation => ({
  id: 'remote-test',
  reference: 'pc_test',
  amountCents: 21500,
  currency: 'COP',
  status,
  environment: 'UAT_SANDBOX',
});
const payInput: PayInput = {
  cardToken: 'opaque-fixture',
  installments: 1,
  acceptance: {
    acceptanceToken: 'policy-fixture',
    personalAuthToken: 'consent-fixture',
    policyAccepted: true,
    personalDataAccepted: true,
  },
};
function unexpected(): never {
  throw new Error('Unexpected persistence or gateway call');
}

function fixture(row = attempt(), held = reservation(), stock = 10) {
  const query = {
    innerJoin: jest.fn<unknown, unknown[]>(),
    where: jest.fn<unknown, unknown[]>(),
    getOne: jest
      .fn<Promise<TransactionOrmEntity | null>, []>()
      .mockResolvedValueOnce(row),
  };
  query.innerJoin.mockImplementation(unexpected).mockReturnValueOnce(query);
  query.where.mockImplementation(unexpected).mockReturnValueOnce(query);
  const methods = {
    createQueryBuilder: jest
      .fn<unknown, unknown[]>()
      .mockReturnValueOnce(query),
    findOneOrFail: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    findOneByOrFail: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    findOneBy: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    update: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockImplementation(unexpected),
    save: jest.fn<Promise<unknown>, unknown[]>().mockImplementation(unexpected),
  };
  const manager = new Proxy(methods, {
    get(target, key: keyof typeof methods) {
      if (!(key in target)) unexpected();
      return target[key];
    },
  }) as unknown as EntityManager;
  type Work = (manager: EntityManager) => Promise<unknown>;
  const executeTransaction = (isolationOrWork: Work | string, work?: Work) =>
    typeof isolationOrWork === 'function'
      ? isolationOrWork(manager)
      : work
        ? work(manager)
        : Promise.reject(new Error('Missing callback'));
  const transaction = jest
    .fn<Promise<unknown>, [Work | string, Work?]>()
    .mockImplementationOnce(executeTransaction);
  const store = new TypeOrmPaymentStore({
    transaction,
  } as unknown as DataSource);
  const snapshot = (fresh = row) => {
    methods.findOneByOrFail.mockResolvedValueOnce(held);
    methods.findOneBy.mockResolvedValueOnce(
      fresh.status === 'APPROVED' ? { id: 'delivery-test' } : null,
    );
  };
  const locked = () => {
    methods.findOneOrFail
      .mockResolvedValueOnce({ id: checkoutId })
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ id: 'product-test', stock })
      .mockResolvedValueOnce(held);
    snapshot();
  };
  const updates = (count: number) => {
    for (let n = 0; n < count; n++)
      methods.update.mockResolvedValueOnce({ affected: 1 });
  };
  const gateway: jest.Mocked<PaymentGateway> = {
    configuration: jest.fn().mockImplementation(unexpected),
    validateAcceptance: jest.fn().mockImplementation(unexpected),
    create: jest.fn().mockImplementation(unexpected),
    get: jest.fn().mockImplementation(unexpected),
  };
  return {
    executeTransaction,
    store,
    transaction,
    query,
    row,
    held,
    snapshot,
    locked,
    updates,
    gateway,
    ...methods,
  };
}

describe('TypeOrmPaymentStore', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads an owned payment snapshot with historical money and known remote ID', async () => {
    const f = fixture(
      attempt({
        providerTransactionId: 'remote-test',
        payRequestHash: 'hash-test',
      }),
    );
    f.snapshot();
    const result = await f.store.read(owner, id);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error('Expected payment record');
    expect(result.value).toEqual({
      view: {
        id,
        checkoutId,
        status: 'PENDING',
        dispatchStatus: 'IN_FLIGHT',
        reservationExpiresAt: expiresAt.toISOString(),
        deliveryId: null,
      },
      reference: 'pc_test',
      amountCents: 21500,
      currency: 'COP',
      quantity: 2,
      buyer,
      environment: 'UAT_SANDBOX',
      providerId: 'remote-test',
      payHash: 'hash-test',
      startedAt: now,
      reservationStatus: 'HELD',
      expiresAt,
    });
    expect(f.query.where).toHaveBeenCalledWith(
      't.id = :id AND c.session_id = :sessionId',
      { id, sessionId: owner },
    );
    expect(f.transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(f.update).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['read', 'run'] as const)(
    'rejects an empty owner query on %s before locks or work',
    async (operation) => {
      const f = fixture();
      f.query.getOne.mockReset().mockResolvedValueOnce(null);
      const work = jest.fn().mockImplementation(unexpected);
      const result = await (operation === 'read'
        ? f.store.read(owner, id)
        : f.store.run(owner, id, work));
      expect(result.isErr() && result.error).toEqual({
        kind: 'RESOURCE_NOT_FOUND',
      });
      expect(f.query.where).toHaveBeenCalledWith(
        't.id = :id AND c.session_id = :sessionId',
        { id, sessionId: owner },
      );
      expect(work).not.toHaveBeenCalled();
      expect(f.findOneOrFail).not.toHaveBeenCalled();
      expect(f.update).not.toHaveBeenCalled();
    },
  );

  it.each(['amount', 'personal'] as const)(
    'translates invalid persisted %s into a typed failure',
    async (field) => {
      const f = fixture(
        attempt(
          field === 'amount' ? { unitPriceCents: -1 } : { buyerSnapshot: {} },
        ),
      );
      f.snapshot();
      const result = await f.store.read(owner, id);
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(f.update).not.toHaveBeenCalled();
    },
  );

  it('locks checkout, attempt, product and reservation before persisting the claim', async () => {
    const f = fixture(attempt({ dispatchStatus: 'NOT_SENT' }));
    f.locked();
    f.updates(1);
    const evidence = {
      policyAccepted: true as const,
      personalDataAccepted: true as const,
      acceptanceTokenHash: 'policy-hash',
      personalAuthTokenHash: 'consent-hash',
    };
    const result = await f.store.run(owner, id, async (ctx) => {
      await ctx.claim('pay-hash', evidence, now);
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(f.findOneOrFail.mock.calls).toEqual([
      [
        CheckoutOrmEntity,
        {
          where: { id: checkoutId, sessionId: owner },
          lock: { mode: 'pessimistic_write' },
        },
      ],
      [
        TransactionOrmEntity,
        { where: { id, checkoutId }, lock: { mode: 'pessimistic_write' } },
      ],
      [
        ProductOrmEntity,
        { where: { id: 'product-test' }, lock: { mode: 'pessimistic_write' } },
      ],
      [
        InventoryReservationOrmEntity,
        { where: { transactionId: id }, lock: { mode: 'pessimistic_write' } },
      ],
    ]);
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update).toHaveBeenCalledWith(TransactionOrmEntity, id, {
      dispatchStatus: 'IN_FLIGHT',
      payRequestHash: 'pay-hash',
      submissionStartedAt: now,
      acceptanceEvidence: evidence,
    });
    expect(f.findOneOrFail.mock.invocationCallOrder[3]).toBeLessThan(
      f.update.mock.invocationCallOrder[0],
    );
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['replay', 'incompatible'] as const)(
    'does not issue another claim or provider create for %s',
    async (mode) => {
      const row = attempt(
        mode === 'replay'
          ? { payRequestHash: 'same-hash' }
          : { dispatchStatus: 'UNKNOWN' },
      );
      const f = fixture(row);
      f.locked();
      if (mode === 'replay') {
        f.findOneByOrFail.mockResolvedValueOnce(row);
        f.snapshot();
      }
      const start = new StartPayment(
        f.store,
        f.gateway,
        { hash: () => 'same-hash' },
        new FinalizePayment(f.store),
      );
      const result = await start.execute(owner, id, payInput);
      expect(
        mode === 'replay'
          ? result.isOk()
          : result.isErr() && result.error.kind === 'CHECKOUT_LOCKED',
      ).toBe(true);
      expect(f.update).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
      expect(f.gateway.create).not.toHaveBeenCalled();
      expect(f.gateway.validateAcceptance).not.toHaveBeenCalled();
      expect(f.transaction).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['PENDING', 'APPROVED'] as const)(
    'persists submission only while attempt is %s',
    async (status) => {
      const f = fixture(attempt({ status }));
      f.locked();
      if (status === 'PENDING') f.updates(1);
      const result = await f.store.run(owner, id, async (ctx) => {
        await ctx.submitted('remote-test');
        return ok(undefined);
      });
      expect(result.isOk()).toBe(true);
      expect(f.update).toHaveBeenCalledTimes(status === 'PENDING' ? 1 : 0);
      if (status === 'PENDING')
        expect(f.update).toHaveBeenCalledWith(TransactionOrmEntity, id, {
          providerTransactionId: 'remote-test',
          dispatchStatus: 'SUBMITTED',
        });
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('confirms approval with stock, reservation, delivery and checkout changes in one callback', async () => {
    const f = fixture();
    f.locked();
    f.updates(4);
    f.save.mockResolvedValueOnce({ id: 'delivery-test' });
    const result = await f.store.run(owner, id, async (ctx) => {
      await ctx.observe(observation(), now);
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(f.update.mock.calls).toEqual([
      [ProductOrmEntity, 'product-test', { stock: 8 }],
      [
        InventoryReservationOrmEntity,
        'reservation-test',
        { status: 'CONFIRMED' },
      ],
      [CheckoutOrmEntity, checkoutId, { status: 'PAID' }],
      [
        TransactionOrmEntity,
        id,
        {
          status: 'APPROVED',
          dispatchStatus: 'SUBMITTED',
          providerTransactionId: 'remote-test',
          finalizedAt: now,
        },
      ],
    ]);
    expect(f.save).toHaveBeenCalledTimes(1);
    const saved = f.save.mock.calls[0][1] as Record<string, unknown>;
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.save).toHaveBeenCalledWith(DeliveryOrmEntity, {
      id: saved.id,
      checkoutId,
      transactionId: id,
      status: 'READY',
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['DECLINED', 'ERROR', 'VOIDED'] as const)(
    'releases reservation for %s without touching stock or delivery',
    async (status) => {
      const f = fixture();
      f.locked();
      f.updates(3);
      const result = await f.store.run(owner, id, async (ctx) => {
        await ctx.observe(observation(status), now);
        return ok(undefined);
      });
      expect(result.isOk()).toBe(true);
      expect(f.update.mock.calls).toEqual([
        [
          InventoryReservationOrmEntity,
          'reservation-test',
          { status: 'RELEASED' },
        ],
        [CheckoutOrmEntity, checkoutId, { status: 'DRAFT' }],
        [
          TransactionOrmEntity,
          id,
          {
            status,
            dispatchStatus: 'SUBMITTED',
            providerTransactionId: 'remote-test',
            finalizedAt: now,
          },
        ],
      ]);
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('records remote PENDING without financial finalization', async () => {
    const f = fixture();
    f.locked();
    f.updates(1);
    const result = await f.store.run(owner, id, async (ctx) => {
      await ctx.observe(observation('PENDING'), now);
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(f.update.mock.calls).toEqual([
      [
        TransactionOrmEntity,
        id,
        { dispatchStatus: 'SUBMITTED', providerTransactionId: 'remote-test' },
      ],
    ]);
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each([undefined, 'GATEWAY_TRANSPORT'])(
    'marks unidentified IN_FLIGHT unknown with reason %s and keeps HELD',
    async (reason) => {
      const f = fixture();
      f.locked();
      f.updates(1);
      const result = await f.store.run(owner, id, async (ctx) => {
        await ctx.unknown(reason);
        return ok(undefined);
      });
      expect(result.isOk()).toBe(true);
      expect(f.update.mock.calls).toEqual([
        [
          TransactionOrmEntity,
          id,
          {
            dispatchStatus: 'UNKNOWN',
            lastErrorCode: reason ?? 'STALE_IN_FLIGHT',
          },
        ],
      ]);
      expect(f.save).not.toHaveBeenCalled();
      expect(f.held.status).toBe('HELD');
    },
  );

  it.each([
    { status: 'APPROVED' as const },
    { dispatchStatus: 'NOT_SENT' as const },
    { providerTransactionId: 'remote-test' },
  ])('does not mark UNKNOWN for ineligible snapshot %#', async (changes) => {
    const f = fixture(attempt(changes));
    f.locked();
    const result = await f.store.run(owner, id, async (ctx) => {
      await ctx.unknown();
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it('expires a deliberately unsent attempt and releases the reservation', async () => {
    const f = fixture(attempt({ dispatchStatus: 'NOT_SENT' }));
    f.locked();
    f.updates(3);
    const result = await f.store.run(owner, id, async (ctx) => {
      await ctx.expire(now);
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(f.update.mock.calls).toEqual([
      [TransactionOrmEntity, id, { status: 'EXPIRED', finalizedAt: now }],
      [
        InventoryReservationOrmEntity,
        'reservation-test',
        { status: 'RELEASED' },
      ],
      [CheckoutOrmEntity, checkoutId, { status: 'DRAFT' }],
    ]);
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['reservation', 'stock', 'update', 'delivery'] as const)(
    'rejects approval failure at %s and stops further writes',
    async (stage) => {
      const f = fixture(
        attempt(),
        reservation(stage === 'reservation' ? 'CONFIRMED' : 'HELD'),
        stage === 'stock' ? 1 : 10,
      );
      f.locked();
      if (stage === 'update')
        f.update.mockRejectedValueOnce(new Error('stock SQL failed'));
      if (stage === 'delivery') {
        f.updates(2);
        f.save.mockRejectedValueOnce(new Error('delivery SQL failed'));
      }
      const result = await f.store.run(owner, id, async (ctx) => {
        await ctx.observe(observation(), now);
        return ok(undefined);
      });
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      await expect(f.transaction.mock.results[0].value).rejects.toThrow();
      expect(f.update).toHaveBeenCalledTimes(
        stage === 'update' ? 1 : stage === 'delivery' ? 2 : 0,
      );
      expect(f.save).toHaveBeenCalledTimes(stage === 'delivery' ? 1 : 0);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it.each(['reference', 'amount', 'currency', 'terminal', 'repeated'] as const)(
    'uses finalizer validation on the real store for %s',
    async (scenario) => {
      const row = attempt(
        scenario === 'terminal' || scenario === 'repeated'
          ? { status: 'APPROVED', providerTransactionId: 'remote-test' }
          : {},
      );
      const f = fixture(row);
      f.locked();
      if (scenario === 'repeated') {
        f.findOneByOrFail.mockResolvedValueOnce(row);
        f.snapshot(row);
      }
      const o = observation(scenario === 'terminal' ? 'DECLINED' : 'APPROVED');
      if (scenario === 'reference') o.reference = 'contradictory';
      if (scenario === 'amount') o.amountCents++;
      if (scenario === 'currency') Object.assign(o, { currency: 'USD' });
      const result = await new FinalizePayment(f.store).execute(owner, id, o);
      if (scenario === 'repeated')
        expect(result.isOk() && result.value.status).toBe('APPROVED');
      else
        expect(result.isErr() && result.error).toEqual({
          kind: 'OBSERVATION_CONFLICT',
        });
      expect(f.update).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('syncs a known remote ID through lookup only and reuses the terminal snapshot', async () => {
    const row = attempt({
      status: 'APPROVED',
      providerTransactionId: 'remote-test',
    });
    const f = fixture(row);
    f.snapshot();
    f.transaction.mockImplementationOnce(f.executeTransaction);
    f.createQueryBuilder.mockReturnValueOnce(f.query);
    f.query.innerJoin.mockReturnValueOnce(f.query);
    f.query.where.mockReturnValueOnce(f.query);
    f.query.getOne.mockResolvedValueOnce(row);
    f.locked();
    f.findOneByOrFail.mockResolvedValueOnce(row);
    f.snapshot(row);
    f.gateway.get.mockReturnValueOnce(okAsync(observation()));
    const result = await new SyncPayment(
      f.store,
      f.gateway,
      new FinalizePayment(f.store),
    ).execute(owner, id);
    expect(result.isOk() && result.value.status).toBe('APPROVED');
    expect(f.gateway.get).toHaveBeenCalledTimes(1);
    expect(f.gateway.get).toHaveBeenCalledWith('remote-test', {
      localId: id,
      reference: 'pc_test',
    });
    expect(f.gateway.create).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['read', 'run'] as const)(
    'translates transaction startup failure on %s',
    async (operation) => {
      const f = fixture();
      f.transaction
        .mockReset()
        .mockRejectedValueOnce(new Error('private connection'));
      const result = await (operation === 'read'
        ? f.store.read(owner, id)
        : f.store.run(owner, id, () => Promise.resolve(ok(undefined))));
      expect(result.isErr() && result.error).toEqual({
        kind: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(f.update).not.toHaveBeenCalled();
    },
  );
});
