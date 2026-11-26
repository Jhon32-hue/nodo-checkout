import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { errAsync } from 'neverthrow';
import Ajv from 'ajv';
import type { OpenAPIObject } from '@nestjs/swagger';
import { PRODUCT_CATEGORIES } from '../src/catalog/domain/product-category';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { loadDatabaseEnvironment } from '../src/infrastructure/database/load-environment';
import { createDatabaseOptions } from '../src/infrastructure/database/database-options';
import {
  catalogProducts,
  seedProducts,
} from '../src/infrastructure/database/seed-products';
import { ProductOrmEntity } from '../src/catalog/infrastructure/typeorm/product.entity';
import { TypeOrmProductRepository } from '../src/catalog/infrastructure/typeorm/typeorm-product.repository';
import type { ProductView } from '../src/catalog/application/product-view';

describe('Catalog HTTP (isolated PostgreSQL)', () => {
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

  it('lists seeded products with exact cent prices and availability', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/products')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const body = response.body as { data: { items: ProductView[] } };
    expect(body.data.items).toHaveLength(10);
    expect(body.data.items[0]).toMatchObject({
      id: catalogProducts[0].id,
      description: catalogProducts[0].description,
      unitPriceCents: 12990000,
      category: 'audio',
      currency: 'COP',
      available: 10,
    });
  });
  it('retrieves a product through its UUID', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/products/${catalogProducts[0].id}`)
      .expect(200);
    expect(response.body).toMatchObject({
      data: {
        id: catalogProducts[0].id,
        name: catalogProducts[0].name,
        available: 10,
      },
    });
  });
  it('rejects malformed UUID with a safe 400 response', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/products/not-a-uuid')
      .expect(400)
      .expect({
        error: {
          code: 'INVALID_PRODUCT_ID',
          message: 'El identificador debe ser un UUID v4 válido.',
        },
      });
  });
  it('returns 404 for a well-formed nonexistent UUID', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/products/${randomUUID()}`)
      .expect(404)
      .expect({
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: 'Producto no encontrado.',
        },
      });
  });
  it('keeps out-of-stock products readable with availability zero', async () => {
    await source
      .getRepository(ProductOrmEntity)
      .update(catalogProducts[0].id, { stock: 0 });
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/products/${catalogProducts[0].id}`)
        .expect(200)
        .expect((response) => {
          expect((response.body as { data: ProductView }).data.available).toBe(
            0,
          );
        });
    } finally {
      await source
        .getRepository(ProductOrmEntity)
        .update(catalogProducts[0].id, { stock: 10 });
    }
  });
  it('hides inactive products in list and detail', async () => {
    await source
      .getRepository(ProductOrmEntity)
      .update(catalogProducts[1].id, { active: false });
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/products/${catalogProducts[1].id}`)
        .expect(404);
      const response = await request(app.getHttpServer())
        .get('/api/v1/products')
        .expect(200);
      expect(
        (response.body as { data: { items: ProductView[] } }).data.items,
      ).toHaveLength(9);
    } finally {
      await source
        .getRepository(ProductOrmEntity)
        .update(catalogProducts[1].id, { active: true });
    }
  });
  it('maps typed infrastructure failure to safe 503 without PostgreSQL details', async () => {
    const mock = jest
      .spyOn(app.get(TypeOrmProductRepository), 'findById')
      .mockReturnValue(errAsync({ kind: 'CatalogUnavailable' }));
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/products/${catalogProducts[0].id}`)
        .expect(503)
        .expect({
          error: {
            code: 'CATALOG_UNAVAILABLE',
            message: 'No fue posible consultar el catálogo.',
          },
        });
    } finally {
      mock.mockRestore();
    }
  });
  it.each(['limit=1', 'limit=invalid', 'cursor=invalid', 'category=audio'])(
    'rejects unsupported query %s instead of silently ignoring it',
    async (query) => {
      for (const path of [
        '/api/v1/products',
        `/api/v1/products/${catalogProducts[0].id}`,
      ]) {
        await request(app.getHttpServer())
          .get(`${path}?${query}`)
          .expect(400)
          .expect({
            error: {
              code: 'INVALID_QUERY_PARAMS',
              message: 'El catálogo no admite parámetros de consulta.',
            },
          });
      }
    },
  );

  it('returns stable order, unique IDs, exact product data and performs no writes', async () => {
    const before: unknown = await source.query(
      'SELECT * FROM products ORDER BY id',
    );
    const countBefore: unknown = await source.query(
      'SELECT (SELECT count(*) FROM transactions) AS attempts, (SELECT count(*) FROM inventory_reservations) AS reservations',
    );
    const first = await request(app.getHttpServer())
      .get('/api/v1/products')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    const second = await request(app.getHttpServer())
      .get('/api/v1/products')
      .expect(200);
    const products = (first.body as { data: { items: ProductView[] } }).data
      .items;
    expect(products.map((product) => product.id)).toEqual(
      catalogProducts.map((product) => product.id),
    );
    expect(new Set(products.map((product) => product.id)).size).toBe(10);
    expect(second.body).toEqual(first.body);
    for (const expected of catalogProducts) {
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/products/${expected.id}`)
        .expect(200);
      expect((detail.body as { data: ProductView }).data).toEqual({
        id: expected.id,
        sku: expected.sku,
        category: expected.category,
        name: expected.name,
        description: expected.description,
        imageUrl: expected.imageUrl,
        unitPriceCents: expected.unitPriceCents,
        currency: 'COP',
        available: expected.stock,
      });
    }
    expect(await source.query('SELECT * FROM products ORDER BY id')).toEqual(
      before,
    );
    expect(
      await source.query(
        'SELECT (SELECT count(*) FROM transactions) AS attempts, (SELECT count(*) FROM inventory_reservations) AS reservations',
      ),
    ).toEqual(countBefore);
  });

  it('returns a sanitized failure for listing as well as detail', async () => {
    const mock = jest
      .spyOn(app.get(TypeOrmProductRepository), 'list')
      .mockReturnValue(errAsync({ kind: 'CatalogUnavailable' }));
    try {
      await request(app.getHttpServer())
        .get('/api/v1/products')
        .expect(503)
        .expect({
          error: {
            code: 'CATALOG_UNAVAILABLE',
            message: 'No fue posible consultar el catálogo.',
          },
        });
    } finally {
      mock.mockRestore();
    }
  });

  it('documents both endpoints and error responses in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const schema = response.body as {
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    expect(schema.paths['/api/v1/products'].get.responses['200']).toBeDefined();
    for (const status of ['200', '400', '404', '503'])
      expect(
        schema.paths['/api/v1/products/{id}'].get.responses[status],
      ).toBeDefined();
  });

  it('admits category values and JSON null while rejecting invalid or missing category in the generated contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = response.body as OpenAPIObject;
    const schema = document.components?.schemas?.ProductDto;
    if (!schema || '$ref' in schema)
      throw new Error('Expected inline ProductDto schema');
    // AJV 6 already installed with the toolchain; enable OpenAPI 3.0 nullable semantics.
    const validate = new Ajv({ nullable: true }).compile(schema);
    const productResponse = await request(app.getHttpServer())
      .get(`/api/v1/products/${catalogProducts[0].id}`)
      .expect(200);
    const product = (productResponse.body as { data: ProductView }).data;
    for (const category of [...PRODUCT_CATEGORIES, null]) {
      expect(validate({ ...product, category })).toBe(true);
    }
    for (const category of ['unsupported-category', 'null']) {
      expect(validate({ ...product, category })).toBe(false);
    }
    const missing: Record<string, unknown> = { ...product };
    delete missing.category;
    expect(validate(missing)).toBe(false);
    expect(schema.required).toContain('category');
  });

  it('documents enforced string limits and nonempty catalog response descriptions', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = response.body as OpenAPIObject;
    const schema = document.components?.schemas?.ProductDto;
    if (!schema || '$ref' in schema)
      throw new Error('Expected inline ProductDto schema');
    expect(schema.properties?.sku).toHaveProperty('maxLength', 64);
    expect(schema.properties?.name).toHaveProperty('maxLength', 120);
    expect(schema.properties?.imageUrl).toHaveProperty('maxLength', 2048);
    expect(schema.properties?.description).not.toHaveProperty('maxLength');
    for (const path of ['/api/v1/products', '/api/v1/products/{id}']) {
      const responses = document.paths[path].get?.responses;
      if (!responses) throw new Error('Missing catalog response contract');
      for (const metadata of Object.values(responses)) {
        if (!metadata || '$ref' in metadata)
          throw new Error('Expected inline response metadata');
        expect(metadata.description.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
