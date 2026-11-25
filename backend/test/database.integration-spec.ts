import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { createDatabaseOptions } from '../src/infrastructure/database/database-options';
import { loadDatabaseEnvironment } from '../src/infrastructure/database/load-environment';
import {
  demoProducts,
  seedProducts,
} from '../src/infrastructure/database/seed-products';
import { ProductOrmEntity } from '../src/catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../src/catalog/infrastructure/typeorm/inventory-reservation.entity';
import { CheckoutSessionOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout-session.entity';
import { CustomerOrmEntity } from '../src/checkout/infrastructure/typeorm/customer.entity';
import { CheckoutOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout.entity';
import { TransactionOrmEntity } from '../src/checkout/infrastructure/typeorm/transaction.entity';
import { DeliveryOrmEntity } from '../src/fulfillment/infrastructure/typeorm/delivery.entity';

describe('PostgreSQL persistence (isolated database)', () => {
  let admin: Client;
  let source: DataSource;
  let runner: QueryRunner;
  let databaseCreated = false;
  const databaseName = `payment_checkout_test_${randomBytes(8).toString('hex')}`;
  const assertSafeTarget = () => {
    if (
      !/^payment_checkout_test_[0-9a-f]{16}$/.test(databaseName) ||
      databaseName === process.env.DB_NAME
    ) {
      throw new Error('Refusing unsafe test database target');
    }
  };

  beforeAll(async () => {
    const env = loadDatabaseEnvironment();
    assertSafeTarget();
    admin = new Client({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: 'postgres',
    });
    await admin.connect();
    // Name generated here, never a user-provided identifier. Needs CREATEDB.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    source = new DataSource(
      createDatabaseOptions({ ...env, DB_NAME: databaseName }),
    );
    await source.initialize();
    await source.runMigrations();
    await seedProducts(source);
  });

  afterAll(async () => {
    try {
      if (source?.isInitialized) await source.destroy();
      if (databaseCreated) {
        assertSafeTarget();
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
    } finally {
      if (admin) await admin.end();
    }
  });

  beforeEach(async () => {
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
  });

  afterEach(async () => {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner && !runner.isReleased) await runner.release();
  });

  async function checkout(manager: EntityManager = runner.manager) {
    const session = await manager.save(CheckoutSessionOrmEntity, {
      id: randomUUID(),
      tokenDigest: randomBytes(32),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const customer = await manager.save(CustomerOrmEntity, {
      id: randomUUID(),
      fullName: 'Cliente Ejemplo',
      email: 'test@example.test',
      phone: '+573000000000',
    });
    return manager.save(CheckoutOrmEntity, {
      id: randomUUID(),
      sessionId: session.id,
      customerId: customer.id,
      productId: demoProducts[0].id,
      quantity: 2,
      status: 'DRAFT',
      deliveryDraft: { recipientName: 'Cliente Ejemplo', country: 'CO' },
    });
  }

  async function attempt(
    basket: CheckoutOrmEntity,
    changes: Partial<TransactionOrmEntity> = {},
    manager: EntityManager = runner.manager,
  ) {
    const repository = manager.getRepository(TransactionOrmEntity);
    return repository.save(
      repository.create({
        id: randomUUID(),
        checkoutId: basket.id,
        productId: basket.productId,
        attemptNumber: 1,
        reference: `pc_${randomUUID().replaceAll('-', '')}`,
        idempotencyKey: randomUUID(),
        createRequestHash: 'a'.repeat(64),
        productName: 'Producto histórico',
        productDescription: 'Descripción histórica',
        quantity: 2,
        unitPriceCents: 250000,
        baseFeeCents: 50000,
        deliveryFeeCents: 100000,
        currency: 'COP',
        buyerSnapshot: {
          fullName: 'Cliente Ejemplo',
          email: 'test@example.test',
        },
        deliverySnapshot: { recipientName: 'Cliente Ejemplo', country: 'CO' },
        ...changes,
      }),
    );
  }

  const approvedFields = (): Partial<TransactionOrmEntity> => ({
    status: 'APPROVED',
    dispatchStatus: 'SUBMITTED',
    payRequestHash: 'b'.repeat(64),
    acceptanceEvidence: { policyAccepted: true },
    submissionStartedAt: new Date(),
    finalizedAt: new Date(),
    providerTransactionId: randomUUID(),
  });

  it('applies the initial migration once and matches ORM metadata without schema drift', async () => {
    expect(await source.runMigrations()).toEqual([]);
    expect(await source.showMigrations()).toBe(false);
    const sql = await source.driver.createSchemaBuilder().log();
    expect(sql.upQueries).toEqual([]);
    expect(source.options.synchronize).toBe(false);
    expect(source.options.migrationsRun).toBe(false);
  });

  it('does not reset consumed stock or edited catalog data when repeating the seed', async () => {
    const repository = source.getRepository(ProductOrmEntity);
    await seedProducts(source);
    await repository.update(demoProducts[0].id, {
      stock: 7,
      name: 'Nombre editado',
    });
    await seedProducts(source);
    expect(await repository.count()).toBe(2);
    expect(
      await repository.findOneByOrFail({ id: demoProducts[0].id }),
    ).toMatchObject({ stock: 7, name: 'Nombre editado' });
  });

  it('persists historical amounts and JSON through ORM relationships', async () => {
    const basket = await checkout();
    const payment = await attempt(basket);
    const loaded = await runner.manager.findOneOrFail(TransactionOrmEntity, {
      where: { id: payment.id },
      relations: { checkout: true, product: true },
    });
    expect(loaded.checkout.id).toBe(basket.id);
    expect(loaded.unitPriceCents).toBe(250000);
    expect(loaded.buyerSnapshot).toMatchObject({ fullName: 'Cliente Ejemplo' });
    expect(loaded.createdAt).toBeInstanceOf(Date);
  });

  it('rejects negative stock', async () => {
    await expect(
      runner.manager.update(ProductOrmEntity, demoProducts[0].id, {
        stock: -1,
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'ck_products_stock' },
    });
  });

  it('rejects monetary overflow using bigint arithmetic in PostgreSQL', async () => {
    const basket = await checkout();
    await expect(
      attempt(basket, { quantity: 99, unitPriceCents: 2000000000 }),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'ck_transactions_money' },
    });
  });

  it('accepts the maximum valid total without rounding', async () => {
    const payment = await attempt(await checkout(), {
      quantity: 1,
      unitPriceCents: 2000000000,
      baseFeeCents: 0,
      deliveryFeeCents: 0,
    });
    expect(payment.unitPriceCents).toBe(2000000000);
  });

  it('rejects approval without a known submission', async () => {
    await expect(
      attempt(await checkout(), {
        status: 'APPROVED',
        finalizedAt: new Date(),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('rejects invalid snapshots', async () => {
    const payment = await attempt(await checkout());
    await expect(
      runner.query(
        'UPDATE transactions SET buyer_snapshot = $1::jsonb WHERE id = $2',
        ['[]', payment.id],
      ),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'ck_transactions_snapshots' },
    });
  });

  it('allows only one concurrent active attempt for the same checkout', async () => {
    const basket = await checkout(source.manager);
    const results = await Promise.allSettled([
      attempt(basket, { attemptNumber: 1 }, source.manager),
      attempt(basket, { attemptNumber: 2 }, source.manager),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed).toMatchObject({
      status: 'rejected',
      reason: {
        driverError: {
          code: '23505',
          constraint: 'uq_transactions_active',
        },
      },
    });
  });

  it('keeps the idempotency key unique even after the attempt has finished', async () => {
    const basket = await checkout();
    const payment = await attempt(basket, {
      status: 'EXPIRED',
      finalizedAt: new Date(),
    });
    await expect(
      attempt(basket, {
        attemptNumber: 2,
        idempotencyKey: payment.idempotencyKey,
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'uq_transactions_idempotency' },
    });
  });

  it('allows only one approved attempt per checkout', async () => {
    const basket = await checkout();
    await attempt(basket, approvedFields());
    await expect(
      attempt(basket, { ...approvedFields(), attemptNumber: 2 }),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'uq_transactions_approved' },
    });
  });

  it('prevents a reservation with a different product or quantity from its attempt', async () => {
    const basket = await checkout();
    const payment = await attempt(basket);
    await expect(
      runner.manager.save(InventoryReservationOrmEntity, {
        id: randomUUID(),
        transactionId: payment.id,
        productId: demoProducts[1].id,
        quantity: payment.quantity,
        expiresAt: new Date(Date.now() + 600000),
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'fk_reservations_attempt' },
    });
  });

  it('prevents a delivery associated with an attempt from another checkout', async () => {
    const basket = await checkout();
    const other = await checkout();
    const payment = await attempt(basket, approvedFields());
    await expect(
      runner.manager.save(DeliveryOrmEntity, {
        id: randomUUID(),
        checkoutId: other.id,
        transactionId: payment.id,
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'fk_deliveries_attempt' },
    });
  });

  it('does not cascade deletion of a product with historical attempts', async () => {
    await attempt(await checkout());
    await expect(
      runner.manager.delete(ProductOrmEntity, demoProducts[0].id),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('reverts and reapplies the schema on the disposable database', async () => {
    await source.undoLastMigration();
    expect(await runner.hasTable('products')).toBe(false);
    await source.runMigrations();
    await seedProducts(source);
    expect(await source.getRepository(ProductOrmEntity).count()).toBe(2);
  });
});
