import 'reflect-metadata';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import type { Result } from 'neverthrow';
import { createDatabaseOptions } from '../src/infrastructure/database/database-options';
import { loadDatabaseEnvironment } from '../src/infrastructure/database/load-environment';
import {
  seedProducts,
  catalogProducts,
} from '../src/infrastructure/database/seed-products';
import { TypeOrmTransactionStore } from '../src/checkout/infrastructure/typeorm/transaction.store';
import { CreateTransaction } from '../src/checkout/application/transaction-cases';
import { CheckoutSessionOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout-session.entity';
import { CustomerOrmEntity } from '../src/checkout/infrastructure/typeorm/customer.entity';
import { CheckoutOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout.entity';
import { TransactionOrmEntity } from '../src/checkout/infrastructure/typeorm/transaction.entity';
import { InventoryReservationOrmEntity } from '../src/catalog/infrastructure/typeorm/inventory-reservation.entity';
import { ProductOrmEntity } from '../src/catalog/infrastructure/typeorm/product.entity';
import { TypeOrmProductRepository } from '../src/catalog/infrastructure/typeorm/typeorm-product.repository';
function value<T, E>(result: Result<T, E>): T {
  if (result.isErr())
    throw new Error(
      'Unexpected fixture error: ' + JSON.stringify(result.error),
    );
  return result.value;
}
const accepted = {
  quantity: 1,
  unitPriceCents: 12990000,
  baseFeeCents: 50000,
  deliveryFeeCents: 100000,
  currency: 'COP',
};
const buyer = {
  fullName: 'Cliente Prueba',
  email: 'buyer@example.test',
  phone: '+573000000000',
};
const delivery = {
  recipientName: 'Cliente Prueba',
  phone: '+573000000000',
  addressLine1: 'Calle de prueba 1',
  city: 'Bogota',
  region: 'Bogota',
  country: 'CO',
};
describe('Transaction concurrency and atomicity (isolated PostgreSQL)', () => {
  let admin: Client;
  let db: DataSource;
  let store: TypeOrmTransactionStore;
  let create: CreateTransaction;
  let created = false;
  const name = 'payment_checkout_test_' + randomBytes(8).toString('hex');
  const productId = catalogProducts[0].id;
  beforeAll(async () => {
    const env = loadDatabaseEnvironment();
    if (
      !/^payment_checkout_test_[0-9a-f]{16}$/.test(name) ||
      name === env.DB_NAME
    )
      throw new Error('Unsafe DB');
    admin = new Client({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: 'postgres',
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    db = new DataSource(createDatabaseOptions({ ...env, DB_NAME: name }));
    await db.initialize();
    await db.runMigrations();
    await seedProducts(db);
    store = new TypeOrmTransactionStore(db);
    create = new CreateTransaction(store, {
      hash: (s) => createHash('sha256').update(s).digest('hex'),
    });
  });
  afterAll(async () => {
    try {
      if (db?.isInitialized) await db.destroy();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      if (admin) await admin.end();
    }
  });
  beforeEach(async () => {
    await db.query('TRUNCATE checkouts, customers, checkout_sessions CASCADE');
    await db
      .getRepository(ProductOrmEntity)
      .update(productId, { stock: 1, active: true, unitPriceCents: 12990000 });
  });
  async function fixture(complete = true) {
    const session = await db.manager.save(CheckoutSessionOrmEntity, {
      id: randomUUID(),
      tokenDigest: randomBytes(32),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const customer = complete
      ? await db.manager.save(CustomerOrmEntity, { id: randomUUID(), ...buyer })
      : null;
    const checkout = await db.manager.save(CheckoutOrmEntity, {
      id: randomUUID(),
      sessionId: session.id,
      customerId: customer?.id ?? null,
      productId,
      quantity: 1,
      status: 'DRAFT',
      deliveryDraft: complete ? delivery : null,
    });
    return checkout;
  }
  async function available() {
    const result = await new TypeOrmProductRepository(
      db.getRepository(ProductOrmEntity),
    ).findById(productId);
    return value(result)?.available;
  }
  it('allows only one of two buyers to reserve the last unit, preserving physical stock', async () => {
    const a = await fixture(),
      b = await fixture();
    expect(await available()).toBe(1);
    const results = await Promise.all([
      create.execute(a.sessionId, a.id, randomUUID(), accepted),
      create.execute(b.sessionId, b.id, randomUUID(), accepted),
    ]);
    expect(results.filter((r) => r.isOk())).toHaveLength(1);
    const failed = results.find((r) => r.isErr());
    expect(failed?.isErr() && failed.error.kind).toBe('INSUFFICIENT_STOCK');
    expect(await available()).toBe(0);
    expect(await db.getRepository(InventoryReservationOrmEntity).count()).toBe(
      1,
    );
    expect(
      (
        await db
          .getRepository(ProductOrmEntity)
          .findOneByOrFail({ id: productId })
      ).stock,
    ).toBe(1);
    expect(await db.query('SELECT * FROM deliveries')).toEqual([]);
  });
  it('serializes identical requests and replays before checking active state', async () => {
    const c = await fixture(),
      key = randomUUID();
    const results = await Promise.all([
      create.execute(c.sessionId, c.id, key, accepted),
      create.execute(c.sessionId, c.id, key.toUpperCase(), { ...accepted }),
    ]);
    expect(value(results[0]).id).toBe(value(results[1]).id);
    expect(await db.getRepository(TransactionOrmEntity).count()).toBe(1);
    expect(await db.getRepository(InventoryReservationOrmEntity).count()).toBe(
      1,
    );
    const conflict = await create.execute(c.sessionId, c.id, key, {
      ...accepted,
      quantity: 2,
    });
    expect(conflict.isErr() && conflict.error.kind).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await db.getRepository(TransactionOrmEntity).count()).toBe(1);
  });
  it('permits only one PENDING when distinct keys race on the same checkout', async () => {
    const c = await fixture();
    const results = await Promise.all([
      create.execute(c.sessionId, c.id, randomUUID(), accepted),
      create.execute(c.sessionId, c.id, randomUUID(), accepted),
    ]);
    expect(results.filter((r) => r.isOk())).toHaveLength(1);
    expect(
      results.some((r) => r.isErr() && r.error.kind === 'CHECKOUT_LOCKED'),
    ).toBe(true);
  });
  it.each(['incomplete', 'changed', 'inactive', 'stock'] as const)(
    'rejects %s without creating attempt or reservation',
    async (reason) => {
      const c = await fixture(reason !== 'incomplete');
      if (reason === 'inactive')
        await db
          .getRepository(ProductOrmEntity)
          .update(productId, { active: false });
      if (reason === 'stock')
        await db
          .getRepository(ProductOrmEntity)
          .update(productId, { stock: 0 });
      const r = await create.execute(
        c.sessionId,
        c.id,
        randomUUID(),
        reason === 'changed' ? { ...accepted, deliveryFeeCents: 1 } : accepted,
      );
      expect(r.isErr() && r.error.kind).toBe(
        {
          incomplete: 'INCOMPLETE_CHECKOUT',
          changed: 'SUMMARY_CHANGED',
          inactive: 'PRODUCT_NOT_FOUND',
          stock: 'INSUFFICIENT_STOCK',
        }[reason],
      );
      expect(await db.getRepository(TransactionOrmEntity).count()).toBe(0);
      expect(
        await db.getRepository(InventoryReservationOrmEntity).count(),
      ).toBe(0);
    },
  );
  it('rolls back attempt and checkout on reservation insert failure', async () => {
    const c = await fixture();
    await db.query(
      'ALTER TABLE inventory_reservations ADD CONSTRAINT test_reservation_failure CHECK (quantity < 0) NOT VALID',
    );
    try {
      const r = await create.execute(c.sessionId, c.id, randomUUID(), accepted);
      expect(r.isErr() && r.error.kind).toBe('PERSISTENCE_UNAVAILABLE');
      expect(await db.getRepository(TransactionOrmEntity).count()).toBe(0);
      expect(
        (
          await db
            .getRepository(CheckoutOrmEntity)
            .findOneByOrFail({ id: c.id })
        ).status,
      ).toBe('DRAFT');
    } finally {
      await db.query(
        'ALTER TABLE inventory_reservations DROP CONSTRAINT test_reservation_failure',
      );
    }
  });
  async function expire(id: string) {
    await db
      .getRepository(InventoryReservationOrmEntity)
      .update({ transactionId: id }, { expiresAt: new Date(0) });
  }
  it('expires its NOT_SENT reservation and creates a new numbered historical attempt', async () => {
    const c = await fixture(),
      key = randomUUID();
    const old = value(await create.execute(c.sessionId, c.id, key, accepted));
    await expire(old.id);
    const next = value(
      await create.execute(c.sessionId, c.id, randomUUID(), accepted),
    );
    expect(next.id).not.toBe(old.id);
    expect(
      (
        await db
          .getRepository(TransactionOrmEntity)
          .findOneByOrFail({ id: next.id })
      ).attemptNumber,
    ).toBe(2);
    expect(
      (
        await db
          .getRepository(TransactionOrmEntity)
          .findOneByOrFail({ id: old.id })
      ).status,
    ).toBe('EXPIRED');
    expect(
      (
        await db
          .getRepository(InventoryReservationOrmEntity)
          .findOneByOrFail({ transactionId: old.id })
      ).status,
    ).toBe('RELEASED');
    expect(
      value(await create.execute(c.sessionId, c.id, key, accepted)).id,
    ).toBe(old.id);
  });
  it.each(['summary', 'stock'] as const)(
    'commits deliberate expiration even when the new request fails for %s',
    async (reason) => {
      const c = await fixture();
      const old = value(
        await create.execute(c.sessionId, c.id, randomUUID(), accepted),
      );
      await expire(old.id);
      if (reason === 'stock')
        await db
          .getRepository(ProductOrmEntity)
          .update(productId, { stock: 0 });
      const r = await create.execute(
        c.sessionId,
        c.id,
        randomUUID(),
        reason === 'summary' ? { ...accepted, baseFeeCents: 0 } : accepted,
      );
      expect(r.isErr() && r.error.kind).toBe(
        reason === 'summary' ? 'SUMMARY_CHANGED' : 'INSUFFICIENT_STOCK',
      );
      expect(
        (
          await db
            .getRepository(TransactionOrmEntity)
            .findOneByOrFail({ id: old.id })
        ).status,
      ).toBe('EXPIRED');
      expect(
        (
          await db
            .getRepository(CheckoutOrmEntity)
            .findOneByOrFail({ id: c.id })
        ).status,
      ).toBe('DRAFT');
      expect(
        (
          await db
            .getRepository(InventoryReservationOrmEntity)
            .findOneByOrFail({ transactionId: old.id })
        ).status,
      ).toBe('RELEASED');
      expect(await db.getRepository(TransactionOrmEntity).count()).toBe(1);
    },
  );
  it.each(['IN_FLIGHT', 'SUBMITTED', 'UNKNOWN'] as const)(
    'retains an expired %s reservation and blocks a new attempt',
    async (dispatchStatus) => {
      const c = await fixture();
      const old = value(
        await create.execute(c.sessionId, c.id, randomUUID(), accepted),
      );
      await expire(old.id);
      await db.getRepository(TransactionOrmEntity).update(old.id, {
        dispatchStatus,
        submissionStartedAt: new Date(),
        payRequestHash: 'a'.repeat(64),
        acceptanceEvidence: { accepted: true },
        providerTransactionId:
          dispatchStatus === 'SUBMITTED' ? 'fixture-provider-id' : null,
      });
      expect(await available()).toBe(0);
      const r = await create.execute(c.sessionId, c.id, randomUUID(), accepted);
      expect(r.isErr() && r.error.kind).toBe('CHECKOUT_LOCKED');
      const other = await fixture();
      const insufficient = await create.execute(
        other.sessionId,
        other.id,
        randomUUID(),
        accepted,
      );
      expect(insufficient.isErr() && insufficient.error.kind).toBe(
        'INSUFFICIENT_STOCK',
      );
    },
  );
  it('reads only owned attempts with frozen amounts and no writes, including negative outcomes', async () => {
    const c = await fixture();
    const attempt = value(
      await create.execute(c.sessionId, c.id, randomUUID(), accepted),
    );
    await expire(attempt.id);
    await db
      .getRepository(ProductOrmEntity)
      .update(productId, { unitPriceCents: 50000 });
    const before: unknown = await db.query('SELECT * FROM transactions');
    const checkoutBefore: unknown = await db.query('SELECT * FROM checkouts');
    const reservationBefore: unknown = await db.query(
      'SELECT * FROM inventory_reservations',
    );
    const r = value(await store.get(c.sessionId, attempt.id, new Date()));
    expect(r).toMatchObject({
      reservationExpired: true,
      summary: { totalCents: 13140000 },
      reservationStatus: 'HELD',
    });
    expect(r).not.toHaveProperty('buyerSnapshot');
    expect(r).not.toHaveProperty('createRequestHash');
    expect(await db.query('SELECT * FROM transactions')).toEqual(before);
    expect(await db.query('SELECT * FROM checkouts')).toEqual(checkoutBefore);
    expect(await db.query('SELECT * FROM inventory_reservations')).toEqual(
      reservationBefore,
    );
    const foreign = await store.get(randomUUID(), attempt.id, new Date());
    const absent = await store.get(c.sessionId, randomUUID(), new Date());
    expect(foreign.isErr() && foreign.error).toEqual(
      absent.isErr() && absent.error,
    );
    await db.getRepository(TransactionOrmEntity).update(attempt.id, {
      status: 'DECLINED',
      dispatchStatus: 'SUBMITTED',
      submissionStartedAt: new Date(),
      payRequestHash: 'a'.repeat(64),
      acceptanceEvidence: { accepted: true },
      providerTransactionId: 'fixture',
      finalizedAt: new Date(),
    });
    expect(
      value(await store.get(c.sessionId, attempt.id, new Date())).status,
    ).toBe('DECLINED');
  });
});
