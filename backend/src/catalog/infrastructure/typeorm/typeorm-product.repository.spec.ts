import type { Repository, SelectQueryBuilder } from 'typeorm';
import { ProductOrmEntity } from './product.entity';
import { InventoryReservationOrmEntity } from './inventory-reservation.entity';
import { TypeOrmProductRepository } from './typeorm-product.repository';

const product = (changes: Partial<ProductOrmEntity> = {}) =>
  Object.assign(
    new ProductOrmEntity(),
    {
      id: '11111111-1111-4111-8111-111111111111',
      sku: 'AUD-001',
      category: 'audio',
      name: 'Audio de prueba',
      description: 'Descripción ficticia',
      imageUrl: 'https://example.test/audio.png',
      unitPriceCents: 10000,
      currency: 'COP',
      stock: 10,
      active: true,
    },
    changes,
  );

function fixture(entities: ProductOrmEntity[], raw: unknown[]) {
  const subquery = {
    select: jest.fn(),
    from: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn<unknown, [string, Record<string, unknown>]>(),
  };
  const sub = new Proxy(subquery, {
    get(target, key: keyof typeof subquery) {
      if (!(key in target))
        throw new Error(`Unexpected subquery method: ${String(key)}`);
      return target[key];
    },
  });
  for (const method of Object.values(subquery)) method.mockReturnValue(sub);
  const query = {
    addSelect: jest.fn(
      (
        build: (q: SelectQueryBuilder<ProductOrmEntity>) => unknown,
      ): unknown => {
        build(sub as unknown as SelectQueryBuilder<ProductOrmEntity>);
        return builder;
      },
    ),
    where: jest.fn(),
    orderBy: jest.fn(),
    andWhere: jest.fn(),
    getRawAndEntities: jest
      .fn<Promise<{ entities: ProductOrmEntity[]; raw: unknown[] }>, []>()
      .mockResolvedValueOnce({ entities, raw }),
  };
  const builder = new Proxy(query, {
    get(target, key: keyof typeof query) {
      if (!(key in target))
        throw new Error(`Unexpected query method: ${String(key)}`);
      return target[key];
    },
  });
  query.where.mockReturnValue(builder);
  query.orderBy.mockReturnValue(builder);
  query.andWhere.mockReturnValue(builder);
  const createQueryBuilder = jest
    .fn<unknown, [string]>()
    .mockReturnValueOnce(builder);
  const repository = new Proxy(
    { createQueryBuilder },
    {
      get(target, key: 'createQueryBuilder') {
        if (!(key in target))
          throw new Error(`Unexpected repository method: ${String(key)}`);
        return target[key];
      },
    },
  ) as unknown as Repository<ProductOrmEntity>;
  return {
    adapter: new TypeOrmProductRepository(repository),
    query,
    subquery,
    createQueryBuilder,
  };
}

describe('TypeOrmProductRepository', () => {
  it('maps catalog fields and subtracts held units without changing physical stock', async () => {
    const entity = product();
    const f = fixture(
      [entity, product({ id: 'second', category: null, stock: 0 })],
      [{ reserved: '3' }, { reserved: '0' }],
    );
    const result = await f.adapter.list();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error('Expected catalog');
    expect(result.value).toEqual([
      {
        id: entity.id,
        sku: entity.sku,
        category: entity.category,
        name: entity.name,
        description: entity.description,
        imageUrl: entity.imageUrl,
        unitPrice: { cents: 10000, currency: 'COP' },
        available: 7,
      },
      expect.objectContaining({ id: 'second', category: null, available: 0 }),
    ]);
    expect(entity.stock).toBe(10);
    expect(f.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(f.createQueryBuilder).toHaveBeenCalledWith('product');
    expect(f.query.getRawAndEntities).toHaveBeenCalledTimes(1);
    expect(f.query.andWhere).not.toHaveBeenCalled();
    expect(f.query.where).toHaveBeenCalledWith('product.active = :active', {
      active: true,
    });
    expect(f.query.orderBy).toHaveBeenCalledWith('product.id', 'ASC');
    expect(f.subquery.from).toHaveBeenCalledWith(
      InventoryReservationOrmEntity,
      'reservation',
    );
    expect(f.subquery.innerJoin).toHaveBeenCalledWith(
      'reservation.transaction',
      'attempt',
    );
    expect(f.subquery.andWhere).toHaveBeenNthCalledWith(
      1,
      'reservation.status = :held',
      { held: 'HELD' },
    );
    expect(f.subquery.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(':notSent'),
      { notSent: 'NOT_SENT' },
    );
    expect(f.subquery.andWhere).toHaveBeenCalledTimes(2);
    expect(f.subquery.andWhere.mock.calls[1][0]).toContain('CURRENT_TIMESTAMP');
  });

  it('binds the detail identifier as a parameter and maps a single row', async () => {
    const entity = product();
    const f = fixture([entity], [{ reserved: '0' }]);
    const id = "not-interpolated-'";
    const result = await f.adapter.findById(id);
    expect(result.isOk() && result.value?.id).toBe(entity.id);
    expect(f.query.andWhere).toHaveBeenCalledTimes(1);
    expect(f.query.andWhere).toHaveBeenCalledWith('product.id = :id', { id });
    expect(f.query.getRawAndEntities).toHaveBeenCalledTimes(1);
  });

  it('returns an empty catalog or null for an absent product', async () => {
    const list = await fixture([], []).adapter.list();
    const detail = await fixture([], []).adapter.findById('missing');
    expect(list.isOk() && list.value).toEqual([]);
    expect(detail.isOk() && detail.value).toBeNull();
  });

  it.each([
    ['missing aggregate', undefined, {}],
    ['non-string aggregate', 2, {}],
    ['negative aggregate', '-1', {}],
    ['unsafe aggregate', '9007199254740992', {}],
    ['over-reserved', '11', {}],
    ['invalid stock', '0', { stock: 1.5 }],
    ['zero price', '0', { unitPriceCents: 0 }],
    ['invalid money', '0', { unitPriceCents: -1 }],
    ['invalid currency', '0', { currency: 'USD' }],
    ['invalid category', '0', { category: 'unsupported' }],
  ])(
    'rejects corrupt persisted data: %s',
    async (_label, reserved, changes) => {
      const entity = Object.assign(product(), changes);
      const result = await fixture([entity], [{ reserved }]).adapter.list();
      expect(result.isErr() && result.error).toEqual({
        kind: 'CatalogUnavailable',
      });
    },
  );

  it.each(['list', 'findById'] as const)(
    'translates SQL rejection for %s',
    async (operation) => {
      const f = fixture([], []);
      f.query.getRawAndEntities
        .mockReset()
        .mockRejectedValueOnce(new Error('private SQL detail'));
      const result = await (operation === 'list'
        ? f.adapter.list()
        : f.adapter.findById('id'));
      expect(result.isErr() && result.error).toEqual({
        kind: 'CatalogUnavailable',
      });
      expect(f.query.getRawAndEntities).toHaveBeenCalledTimes(1);
    },
  );
});
