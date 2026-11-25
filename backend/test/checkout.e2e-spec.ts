import Ajv from 'ajv';
import type { OpenAPIObject } from '@nestjs/swagger';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { loadDatabaseEnvironment } from '../src/infrastructure/database/load-environment';
import { createDatabaseOptions } from '../src/infrastructure/database/database-options';
import {
  catalogProducts,
  seedProducts,
} from '../src/infrastructure/database/seed-products';
import { CheckoutSessionOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout-session.entity';
import { CheckoutOrmEntity } from '../src/checkout/infrastructure/typeorm/checkout.entity';
import { CustomerOrmEntity } from '../src/checkout/infrastructure/typeorm/customer.entity';
import { TransactionOrmEntity } from '../src/checkout/infrastructure/typeorm/transaction.entity';
import { ProductOrmEntity } from '../src/catalog/infrastructure/typeorm/product.entity';
describe('Recoverable checkout (isolated PostgreSQL)', () => {
  let admin: Client;
  let source: DataSource;
  let app: INestApplication<App>;
  let created = false;
  const name = `payment_checkout_test_${randomBytes(8).toString('hex')}`;
  const assertSafe = () => {
    if (
      !/^payment_checkout_test_[0-9a-f]{16}$/.test(name) ||
      name === process.env.DB_NAME
    )
      throw new Error('Unsafe test database');
  };

  beforeAll(async () => {
    const env = loadDatabaseEnvironment();
    assertSafe();
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
    source = new DataSource(createDatabaseOptions({ ...env, DB_NAME: name }));
    await source.initialize();
    await source.runMigrations();
    await seedProducts(source);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ ...env, DB_NAME: name }))
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  }, 30000);

  afterAll(async () => {
    try {
      if (app) await app.close();
      if (source?.isInitialized) await source.destroy();
      if (created) {
        assertSafe();
        await admin.query(`DROP DATABASE "${name}"`);
      }
    } finally {
      if (admin) await admin.end();
    }
  });

  const origin = 'http://localhost:3000';
  const buyer = {
    fullName: '  MarÃ­a GÃ³mez  ',
    email: 'maria@example.test',
    phone: '+573000000000',
  };
  const delivery = {
    recipientName: ' MarÃ­a GÃ³mez ',
    phone: '+573000000000',
    addressLine1: ' Calle 1 nÃºmero 2 ',
    city: 'BogotÃ¡',
    region: 'BogotÃ¡ D.C.',
    country: 'CO',
  };
  async function login(cookie?: string) {
    let call = request(app.getHttpServer())
      .post('/api/v1/checkout-sessions')
      .set('Origin', origin);
    if (cookie) call = call.set('Cookie', cookie);
    const response = await call;
    expect(response.status).toBe(cookie ? 200 : 201);
    const body = response.body as {
      data: { csrfToken: string; expiresAt: string };
    };
    const cookies: unknown = response.headers['set-cookie'];
    let value = cookie;
    if (Array.isArray(cookies)) {
      const first: unknown = cookies[0];
      if (typeof first === 'string') {
        expect(first).toContain('HttpOnly');
        expect(first).toContain('SameSite=Lax');
        value = first.split(';')[0];
      }
    }
    if (!value) throw new Error('Missing session cookie');
    expect(Object.keys(body.data).sort()).toEqual(['csrfToken', 'expiresAt']);
    return {
      cookie: value,
      csrf: body.data.csrfToken,
      expires: body.data.expiresAt,
    };
  }
  async function create(auth: Awaited<ReturnType<typeof login>>) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/checkouts')
      .set('Origin', origin)
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({ productId: catalogProducts[0].id, quantity: 2 })
      .expect(201);
    return (response.body as { data: { id: string } }).data.id;
  }
  it('creates/reuses guest session without renewal and stores only its digest', async () => {
    const auth = await login();
    const reused = await login(auth.cookie);
    expect(reused.expires).toBe(auth.expires);
    expect(reused.csrf).toBe(auth.csrf);
    const token = auth.cookie.split('=')[1];
    const record = await source
      .getRepository(CheckoutSessionOrmEntity)
      .findOneByOrFail({
        tokenDigest: Buffer.from(
          createHash('sha256').update(token).digest('hex'),
          'hex',
        ),
      });
    expect(record.tokenDigest.equals(Buffer.from(token))).toBe(false);
  });
  it('rejects missing/expired session, bad Origin and bad CSRF', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/checkout-sessions')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/checkouts/' + randomUUID())
      .expect(401);
    const auth = await login();
    await request(app.getHttpServer())
      .post('/api/v1/checkouts')
      .set('Origin', origin)
      .set('Cookie', auth.cookie)
      .send({ productId: catalogProducts[0].id, quantity: 2 })
      .expect(403);
    await source.getRepository(CheckoutSessionOrmEntity).update(
      {
        tokenDigest: Buffer.from(
          createHash('sha256').update(auth.cookie.split('=')[1]).digest('hex'),
          'hex',
        ),
      },
      { expiresAt: new Date(0) },
    );
    await request(app.getHttpServer())
      .get('/api/v1/checkouts/' + randomUUID())
      .set('Cookie', auth.cookie)
      .expect(401);
  });
  it('rejects missing/inactive products, invalid quantities, unauthorized fields and bad Origin', async () => {
    const auth = await login();
    const createBody = (body: object, requestOrigin = origin) =>
      request(app.getHttpServer())
        .post('/api/v1/checkouts')
        .set('Origin', requestOrigin)
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf)
        .send(body);
    await createBody({ productId: randomUUID(), quantity: 2 }).expect(404);
    for (const quantity of [0, 100, 1.5, '2', null])
      await createBody({ productId: catalogProducts[0].id, quantity }).expect(
        400,
      );
    await createBody({
      productId: catalogProducts[0].id,
      quantity: 2,
      unitPriceCents: 1,
    }).expect(400);
    await createBody(
      { productId: catalogProducts[0].id, quantity: 2 },
      'https://evil.example',
    ).expect(403);
    await source
      .getRepository(ProductOrmEntity)
      .update(catalogProducts[1].id, { active: false });
    try {
      await createBody({
        productId: catalogProducts[1].id,
        quantity: 2,
      }).expect(404);
    } finally {
      await source
        .getRepository(ProductOrmEntity)
        .update(catalogProducts[1].id, { active: true });
    }
  });

  it('saves full buyer/delivery fields, calculates exact summary and recovers after backend restart', async () => {
    const stockBefore: unknown = await source.query(
      'SELECT id,stock FROM products ORDER BY id',
    );
    const auth = await login();
    const id = await create(auth);
    await request(app.getHttpServer())
      .get(`/api/v1/checkouts/${id}/summary`)
      .set('Cookie', auth.cookie)
      .expect(422);
    for (const patch of [{ buyer }, { delivery }])
      await request(app.getHttpServer())
        .patch(`/api/v1/checkouts/${id}`)
        .set('Origin', origin)
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf)
        .send(patch)
        .expect(200);
    const summary = {
      quantity: 2,
      unitPriceCents: 12990000,
      subtotalCents: 25980000,
      baseFeeCents: 50000,
      deliveryFeeCents: 100000,
      totalCents: 26130000,
      currency: 'COP',
    };
    await request(app.getHttpServer())
      .get(`/api/v1/checkouts/${id}/summary`)
      .set('Cookie', auth.cookie)
      .expect(200)
      .expect({ data: summary });
    const stranger = await login();
    for (const target of [id, randomUUID()])
      await request(app.getHttpServer())
        .get('/api/v1/checkouts/' + target)
        .set('Cookie', stranger.cookie)
        .expect(404);
    await app.close();
    const env = loadDatabaseEnvironment();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ ...env, DB_NAME: name }))
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    const restored = await request(app.getHttpServer())
      .get('/api/v1/checkouts/' + id)
      .set('Cookie', auth.cookie)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(restored.body).toMatchObject({
      data: {
        id,
        buyer: { fullName: 'MarÃ­a GÃ³mez' },
        delivery: { addressLine1: 'Calle 1 nÃºmero 2' },
        activeTransactionId: null,
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/checkouts/${id}/summary`)
      .set('Cookie', auth.cookie)
      .expect(200)
      .expect({ data: summary });
    expect(
      await source.query('SELECT id,stock FROM products ORDER BY id'),
    ).toEqual(stockBefore);
    expect(await source.query('SELECT * FROM inventory_reservations')).toEqual(
      [],
    );
    expect(await source.query('SELECT * FROM deliveries')).toEqual([]);
  });
  it('rejects invalid input, foreign writes and locked drafts; rolls back a failed persistence write', async () => {
    const auth = await login();
    const id = await create(auth);
    const stranger = await login();
    const patch = (body: unknown, who = auth) =>
      request(app.getHttpServer())
        .patch('/api/v1/checkouts/' + id)
        .set('Origin', origin)
        .set('Cookie', who.cookie)
        .set('X-CSRF-Token', who.csrf)
        .send(body as object);
    for (const body of [
      {},
      { buyer: { fullName: 'X' } },
      { buyer: { ...buyer, extra: true } },
      { delivery: { ...delivery, pan: 'forbidden' } },
      { quantity: null },
      { quantity: 100 },
      { status: 'PAID' },
    ])
      await patch(body).expect(400);
    await patch({ quantity: 3 }, stranger).expect(404);
    const count = await source.getRepository(CustomerOrmEntity).count();
    await source.query(
      `ALTER TABLE checkouts ADD CONSTRAINT test_reject_delivery CHECK (id <> '${id}'::uuid OR delivery_draft IS NULL)`,
    );
    try {
      await patch({ buyer, delivery }).expect(503);
      expect(await source.getRepository(CustomerOrmEntity).count()).toBe(count);
    } finally {
      await source.query(
        'ALTER TABLE checkouts DROP CONSTRAINT test_reject_delivery',
      );
    }
    await patch({ buyer, delivery }).expect(200);
    await source
      .getRepository(CheckoutOrmEntity)
      .update(id, { status: 'PAYMENT_PENDING' });
    await patch({ quantity: 3 }).expect(409);
    await source.getRepository(TransactionOrmEntity).save({
      id: randomUUID(),
      checkoutId: id,
      attemptNumber: 1,
      reference: randomUUID(),
      idempotencyKey: randomUUID(),
      createRequestHash: 'a'.repeat(64),
      productId: catalogProducts[0].id,
      productName: 'Historical',
      productDescription: 'Historical description',
      quantity: 2,
      unitPriceCents: 100,
      baseFeeCents: 50,
      deliveryFeeCents: 10,
      currency: 'COP',
      buyerSnapshot: {},
      deliverySnapshot: {},
    });
    await source
      .getRepository(ProductOrmEntity)
      .update(catalogProducts[0].id, { unitPriceCents: 200 });
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/checkouts/${id}/summary`)
        .set('Cookie', auth.cookie)
        .expect(200)
        .expect({
          data: {
            quantity: 2,
            unitPriceCents: 100,
            subtotalCents: 200,
            baseFeeCents: 50,
            deliveryFeeCents: 10,
            totalCents: 260,
            currency: 'COP',
          },
        });
    } finally {
      await source
        .getRepository(ProductOrmEntity)
        .update(catalogProducts[0].id, { unitPriceCents: 12990000 });
    }
  });
  it('requires data in every checkout success response and all summary amounts', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = response.body as OpenAPIObject;
    for (const [path, method, status] of [
      ['/api/v1/checkout-sessions', 'post', '200'],
      ['/api/v1/checkout-sessions', 'post', '201'],
      ['/api/v1/checkouts', 'post', '201'],
      ['/api/v1/checkouts/{id}', 'get', '200'],
      ['/api/v1/checkouts/{id}', 'patch', '200'],
      ['/api/v1/checkouts/{id}/summary', 'get', '200'],
    ] as const) {
      const metadata = document.paths[path][method]?.responses[status];
      if (!metadata || '$ref' in metadata)
        throw new Error('Missing response schema');
      const schema = metadata.content?.['application/json']?.schema;
      if (!schema || '$ref' in schema)
        throw new Error('Expected inline response schema');
      expect(schema.required).toContain('data');
      const ajv = new Ajv({ nullable: true });
      for (const [name, component] of Object.entries(
        document.components?.schemas ?? {},
      ))
        ajv.addSchema(component, `#/components/schemas/${name}`);
      const validate = ajv.compile(schema);
      expect(validate({})).toBe(false);
      if (path.endsWith('/summary')) {
        const summary: Record<string, unknown> = {
          quantity: 2,
          unitPriceCents: 12990000,
          subtotalCents: 25980000,
          baseFeeCents: 50000,
          deliveryFeeCents: 100000,
          totalCents: 26130000,
          currency: 'COP',
        };
        expect(validate({ data: summary })).toBe(true);
        for (const key of Object.keys(summary)) {
          const missing = { ...summary };
          delete missing[key];
          expect(validate({ data: missing })).toBe(false);
        }
      }
    }
  });
  it('creates and recovers an owned reservation with idempotency, validation and private responses', async () => {
    const auth = await login();
    const id = await create(auth);
    await request(app.getHttpServer())
      .patch(`/api/v1/checkouts/${id}`)
      .set('Origin', origin)
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({ buyer, delivery })
      .expect(200);
    const acceptedSummary = {
      quantity: 2,
      unitPriceCents: 12990000,
      baseFeeCents: 50000,
      deliveryFeeCents: 100000,
      currency: 'COP',
    };
    const body = { checkoutId: id, acceptedSummary };
    const key = randomUUID();
    const post = (input: unknown = body, idempotencyKey = key) =>
      request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Origin', origin)
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf)
        .set('Idempotency-Key', idempotencyKey)
        .send(input);
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', origin)
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', origin)
      .set('Cookie', auth.cookie)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', 'https://evil.example')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', origin)
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send(body)
      .expect(400);
    await post(body, 'invalid-key').expect(400);
    for (const input of [
      { ...body, cardToken: 'forbidden' },
      { ...body, acceptedSummary: { ...acceptedSummary, unknown: 1 } },
      { ...body, acceptedSummary: { ...acceptedSummary, quantity: '2' } },
      { ...body, acceptedSummary: null },
    ])
      await post(input).expect(400);
    const before = (
      await source
        .getRepository(ProductOrmEntity)
        .findOneByOrFail({ id: catalogProducts[0].id })
    ).stock;
    const catalogBefore = await request(app.getHttpServer())
      .get(`/api/v1/products/${catalogProducts[0].id}`)
      .expect(200);
    const response = await post()
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const attempt = (
      response.body as {
        data: { id: string; status: string; dispatchStatus: string };
      }
    ).data;
    expect(attempt).toMatchObject({
      status: 'PENDING',
      dispatchStatus: 'NOT_SENT',
    });
    const replay = await post().expect(201);
    expect(replay.body).toEqual(response.body);
    await post({
      ...body,
      acceptedSummary: { ...acceptedSummary, quantity: 1 },
    })
      .expect(409)
      .expect({
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'IDEMPOTENCY_CONFLICT',
        },
      });
    await post(body, randomUUID()).expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/checkouts/${id}`)
      .set('Origin', origin)
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({ quantity: 1 })
      .expect(409);
    const rowsBefore: unknown = await source.query(
      'SELECT * FROM transactions ORDER BY id',
    );
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${attempt.id}`)
      .set('Cookie', auth.cookie)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(detail.body).toMatchObject({
      data: {
        ...attempt,
        summary: { totalCents: 26130000 },
        reservationStatus: 'HELD',
        reservationExpired: false,
        finalizedAt: null,
      },
    });
    expect(
      Object.keys(
        (detail.body as { data: Record<string, unknown> }).data,
      ).sort(),
    ).toEqual(
      [
        'id',
        'checkoutId',
        'status',
        'dispatchStatus',
        'reservationExpiresAt',
        'deliveryId',
        'reference',
        'summary',
        'createdAt',
        'finalizedAt',
        'reservationStatus',
        'reservationExpired',
      ].sort(),
    );
    expect(
      await source.query('SELECT * FROM transactions ORDER BY id'),
    ).toEqual(rowsBefore);
    const other = await login();
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', origin)
      .set('Cookie', other.cookie)
      .set('X-CSRF-Token', other.csrf)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(404);
    const foreign = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${attempt.id}`)
      .set('Cookie', other.cookie)
      .expect(404);
    const missing = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${randomUUID()}`)
      .set('Cookie', auth.cookie)
      .expect(404);
    expect(foreign.body).toEqual(missing.body);
    await request(app.getHttpServer())
      .get(`/api/v1/transactions/${attempt.id}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/transactions/invalid')
      .set('Cookie', auth.cookie)
      .expect(400);
    const catalogAfter = await request(app.getHttpServer())
      .get(`/api/v1/products/${catalogProducts[0].id}`)
      .expect(200);
    expect(
      (catalogAfter.body as { data: { available: number } }).data.available,
    ).toBe(
      (catalogBefore.body as { data: { available: number } }).data.available -
        2,
    );
    expect(
      (
        await source
          .getRepository(ProductOrmEntity)
          .findOneByOrFail({ id: catalogProducts[0].id })
      ).stock,
    ).toBe(before);
    await source.getRepository(TransactionOrmEntity).update(attempt.id, {
      status: 'DECLINED',
      dispatchStatus: 'SUBMITTED',
      submissionStartedAt: new Date(),
      payRequestHash: 'a'.repeat(64),
      acceptanceEvidence: { accepted: true },
      providerTransactionId: 'fixture-declined',
      finalizedAt: new Date(),
    });
    const declined = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${attempt.id}`)
      .set('Cookie', auth.cookie)
      .expect(200);
    expect(declined.body).toMatchObject({
      data: { status: 'DECLINED', summary: { totalCents: 26130000 } },
    });
    const document = (await request(app.getHttpServer()).get('/docs-json'))
      .body as OpenAPIObject;
    expect(
      document.paths['/api/v1/transactions'].post?.responses['201'],
    ).toBeDefined();
    expect(
      document.paths['/api/v1/transactions/{id}'].get?.responses['200'],
    ).toBeDefined();
  });
});
