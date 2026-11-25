import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { createDatabaseOptions } from '../src/infrastructure/database/database-options';
import { loadDatabaseEnvironment } from '../src/infrastructure/database/load-environment';
import {
  catalogProducts,
  seedProducts,
} from '../src/infrastructure/database/seed-products';
import { ProductOrmEntity } from '../src/catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../src/catalog/infrastructure/typeorm/inventory-reservation.entity';
import { CheckoutSessionOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout-session.entity';
import { CustomerOrmEntity } from '../src/checkout/infrastructure/typeorm/customer.entity';
import { CheckoutOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout.entity';
import { TransactionOrmEntity } from '../src/checkout/infrastructure/typeorm/transaction.entity';
import { DeliveryOrmEntity } from '../src/fulfillment/infrastructure/typeorm/delivery.entity';
import { TypeOrmProductRepository } from '../src/catalog/infrastructure/typeorm/typeorm-product.repository';

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
      productId: catalogProducts[0].id,
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
    await repository.update(catalogProducts[0].id, {
      stock: 7,
      name: 'Nombre editado',
    });
    await seedProducts(source);
    expect(await repository.count()).toBe(10);
    expect(
      await repository.findOneByOrFail({ id: catalogProducts[0].id }),
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
      runner.manager.update(ProductOrmEntity, catalogProducts[0].id, {
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
        productId: catalogProducts[1].id,
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
      runner.manager.delete(ProductOrmEntity, catalogProducts[0].id),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('reads active and sold-out products through the TypeORM catalog adapter', async () => {
    await runner.manager.update(ProductOrmEntity, catalogProducts[0].id, {
      stock: 0,
    });
    const repository = new TypeOrmProductRepository(
      runner.manager.getRepository(ProductOrmEntity),
    );
    const listed = await repository.list();
    if (listed.isErr()) throw new Error('Unexpected catalog error');
    expect(listed.value.map((product) => product.id)).toEqual(
      catalogProducts.map((product) => product.id),
    );
    expect(listed.value[0].available).toBe(0);
    const found = await repository.findById(catalogProducts[0].id);
    if (found.isErr()) throw new Error('Unexpected catalog error');
    expect(found.value).toMatchObject({
      id: catalogProducts[0].id,
      unitPrice: { cents: 12990000, currency: 'COP' },
      available: 0,
    });
  });

  it('returns null for missing or inactive products and omits inactive items', async () => {
    await runner.manager.update(ProductOrmEntity, catalogProducts[1].id, {
      active: false,
    });
    const repository = new TypeOrmProductRepository(
      runner.manager.getRepository(ProductOrmEntity),
    );
    for (const id of [catalogProducts[1].id, randomUUID()]) {
      const found = await repository.findById(id);
      if (found.isErr()) throw new Error('Unexpected catalog error');
      expect(found.value).toBeNull();
    }
    const listed = await repository.list();
    if (listed.isErr()) throw new Error('Unexpected catalog error');
    expect(listed.value.map((product) => product.id)).toEqual(
      catalogProducts
        .filter((product) => product.id !== catalogProducts[1].id)
        .map((product) => product.id),
    );
  });

  it('calculates availability from held reservations and preserves uncertain payments after expiry', async () => {
    await runner.manager.update(ProductOrmEntity, catalogProducts[0].id, {
      stock: 10,
    });
    const future = new Date(Date.now() + 600000);
    const past = new Date(Date.now() - 600000);
    const fixtures: {
      quantity: number;
      dispatch: TransactionOrmEntity['dispatchStatus'];
      expires: Date;
      reservation: InventoryReservationOrmEntity['status'];
    }[] = [
      {
        quantity: 2,
        dispatch: 'NOT_SENT',
        expires: future,
        reservation: 'HELD',
      },
      { quantity: 1, dispatch: 'NOT_SENT', expires: past, reservation: 'HELD' },
      { quantity: 1, dispatch: 'UNKNOWN', expires: past, reservation: 'HELD' },
      {
        quantity: 1,
        dispatch: 'IN_FLIGHT',
        expires: past,
        reservation: 'HELD',
      },
      {
        quantity: 1,
        dispatch: 'SUBMITTED',
        expires: past,
        reservation: 'HELD',
      },
      {
        quantity: 1,
        dispatch: 'NOT_SENT',
        expires: future,
        reservation: 'RELEASED',
      },
      {
        quantity: 1,
        dispatch: 'SUBMITTED',
        expires: future,
        reservation: 'CONFIRMED',
      },
    ];
    for (const fixture of fixtures) {
      const basket = await checkout();
      const changes: Partial<TransactionOrmEntity> = {
        quantity: fixture.quantity,
        dispatchStatus: fixture.dispatch,
      };
      if (fixture.dispatch !== 'NOT_SENT') {
        changes.submissionStartedAt = new Date();
        changes.payRequestHash = 'b'.repeat(64);
        changes.acceptanceEvidence = { policyAccepted: true };
      }
      if (fixture.dispatch === 'SUBMITTED')
        changes.providerTransactionId = randomUUID();
      if (fixture.reservation === 'CONFIRMED') {
        changes.status = 'APPROVED';
        changes.finalizedAt = new Date();
      }
      const payment = await attempt(basket, changes);
      await runner.manager.save(InventoryReservationOrmEntity, {
        id: randomUUID(),
        transactionId: payment.id,
        productId: payment.productId,
        quantity: fixture.quantity,
        expiresAt: fixture.expires,
        status: fixture.reservation,
      });
    }
    const repository = new TypeOrmProductRepository(
      runner.manager.getRepository(ProductOrmEntity),
    );
    const found = await repository.findById(catalogProducts[0].id);
    if (found.isErr()) throw new Error('Unexpected catalog error');
    expect(found.value?.available).toBe(5); // 10 - (2 current + 1 unknown + 1 in-flight + 1 submitted).
    const other = await repository.findById(catalogProducts[1].id);
    if (other.isErr()) throw new Error('Unexpected catalog error');
    expect(other.value?.available).toBe(5); // Reservations belong to the first product only.
  });

  it('translates database access failure into a typed catalog error', async () => {
    const released = source.createQueryRunner();
    await released.connect();
    await released.release();
    const repository = new TypeOrmProductRepository(
      released.manager.getRepository(ProductOrmEntity),
    );
    const result = await repository.list();
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error).toEqual({ kind: 'CatalogUnavailable' });
  });

  it('seeds the ten approved prices and rejects an unsupported category', async () => {
    const expected = {
      'AUD-001': 12990000,
      'AUD-002': 17990000,
      'COM-001': 18990000,
      'COM-002': 7990000,
      'COM-003': 11990000,
      'ACC-001': 9990000,
      'ACC-002': 14990000,
      'ALM-001': 32990000,
      'HOG-001': 4990000,
      'HOG-002': 5990000,
    };
    const rows = await runner.manager.find(ProductOrmEntity);
    expect(
      Object.fromEntries(
        rows.map((product) => [product.sku, product.unitPriceCents]),
      ),
    ).toEqual(expected);
    expect(
      rows.every(
        (product) => product.category !== null && product.currency === 'COP',
      ),
    ).toBe(true);
    await expect(
      runner.query('UPDATE products SET category = $1 WHERE id = $2', [
        'invalid',
        catalogProducts[0].id,
      ]),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'ck_products_category' },
    });
  });

  async function resetToLegacyProducts(customizeSecond = false) {
    assertSafeTarget();
    await source.undoLastMigration(); // Keep InitialSchema, remove category only.
    await source.query('TRUNCATE TABLE products CASCADE'); // Disposable DB only.
    await source.query(
      `INSERT INTO products (id,sku,name,description,image_url,unit_price_cents,currency,stock,active)
      VALUES ($1,'DEMO-HEADPHONES','Auriculares de ejemplo','Producto ficticio para checkout sandbox.',
      'https://placehold.co/800x600/png?text=Auriculares',250000,'COP',7,true),
      ($2,'DEMO-SPEAKER',$3,'Segundo producto ficticio para checkout sandbox.',
      'https://placehold.co/800x600/png?text=Parlante',500000,'COP',5,true)`,
      [
        catalogProducts[0].id,
        catalogProducts[1].id,
        customizeSecond ? 'Parlante personalizado' : 'Parlante de ejemplo',
      ],
    );
  }

  it('transitions original IDs once, preserves stock, reservations, history and unrelated products', async () => {
    await resetToLegacyProducts();
    const basket = await checkout(source.manager);
    const payment = await attempt(basket, {}, source.manager);
    await source.manager.save(InventoryReservationOrmEntity, {
      id: randomUUID(),
      transactionId: payment.id,
      productId: payment.productId,
      quantity: payment.quantity,
      expiresAt: new Date(Date.now() + 600000),
    });
    const foreignId = randomUUID();
    await source.query(
      `INSERT INTO products (id,sku,name,description,image_url,unit_price_cents,currency,stock,active)
      VALUES ($1,'OWN-001','Producto ajeno','Descripción propia','https://example.test/own.png',100,'COP',3,true)`,
      [foreignId],
    );
    const history: unknown = await source.query(
      'SELECT * FROM transactions ORDER BY id',
    );
    const reservations: unknown = await source.query(
      'SELECT * FROM inventory_reservations ORDER BY id',
    );
    await source.runMigrations();
    await seedProducts(source);
    const first = await source
      .getRepository(ProductOrmEntity)
      .findOneByOrFail({ id: catalogProducts[0].id });
    expect(first).toMatchObject({
      sku: 'AUD-001',
      stock: 7,
      category: 'audio',
      unitPriceCents: 12990000,
    });
    expect(await source.getRepository(ProductOrmEntity).count()).toBe(11);
    expect(
      await source.query('SELECT * FROM transactions ORDER BY id'),
    ).toEqual(history);
    expect(
      await source.query('SELECT * FROM inventory_reservations ORDER BY id'),
    ).toEqual(reservations);
    expect(
      await source
        .getRepository(ProductOrmEntity)
        .findOneByOrFail({ id: foreignId }),
    ).toMatchObject({ sku: 'OWN-001', stock: 3, category: null });
    const foreignCatalog = await new TypeOrmProductRepository(
      source.getRepository(ProductOrmEntity),
    ).findById(foreignId);
    if (foreignCatalog.isErr()) throw new Error('Unexpected catalog error');
    expect(foreignCatalog.value).toMatchObject({
      id: foreignId,
      category: null,
      available: 3,
    });
    await source.getRepository(ProductOrmEntity).update(first.id, {
      stock: 4,
      name: 'Nombre posterior',
      sku: 'OWN-EDIT',
    });
    const before: unknown = await source.query(
      'SELECT * FROM products ORDER BY id',
    );
    await seedProducts(source);
    expect(await source.query('SELECT * FROM products ORDER BY id')).toEqual(
      before,
    );
    // Restore only this disposable fixture database for the following tests.
    assertSafeTarget();
    await source.query('TRUNCATE TABLE products CASCADE');
    await seedProducts(source);
  });

  it('aborts a customized-original transition atomically without overwriting it', async () => {
    await resetToLegacyProducts(true);
    await expect(source.runMigrations()).rejects.toThrow(
      'CATALOG_TRANSITION_CONFLICT',
    );
    const rows = await source.query<
      { sku: string; name: string; stock: number }[]
    >('SELECT sku,name,stock FROM products ORDER BY id');
    expect(rows).toEqual([
      { sku: 'DEMO-HEADPHONES', name: 'Auriculares de ejemplo', stock: 7 },
      { sku: 'DEMO-SPEAKER', name: 'Parlante personalizado', stock: 5 },
    ]);
    expect(await runner.hasColumn('products', 'category')).toBe(false);
    assertSafeTarget();
    await source.query('TRUNCATE TABLE products CASCADE');
    await source.runMigrations();
    await seedProducts(source);
  });

  it('reverts and reapplies the schema on the disposable database', async () => {
    await source.undoLastMigration();
    expect(await runner.hasColumn('products', 'category')).toBe(false);
    await source.undoLastMigration();
    expect(await runner.hasTable('products')).toBe(false);
    await source.runMigrations();
    await seedProducts(source);
    expect(await source.getRepository(ProductOrmEntity).count()).toBe(10);
  });
});
