import { errAsync, okAsync } from 'neverthrow';
import { Money } from '../../shared/domain/money';
import type { Product } from '../domain/product';
import type { ProductRepository } from './product-repository';
import { ListProducts } from './list-products';
import { GetProduct } from './get-product';

const id = '11111111-1111-4111-8111-111111111111';
function product(available = 10): Product {
  const price = Money.fromCents(12990000, 'COP');
  if (price.isErr()) throw new Error('Invalid test price');
  return {
    id,
    sku: 'AUD-001',
    category: 'audio',
    name: 'Auriculares inalámbricos Nova',
    description: 'Auriculares Bluetooth Nova.',
    imageUrl: 'https://example.test/product.png',
    unitPrice: price.value,
    available,
  };
}
function repository(): jest.Mocked<ProductRepository> {
  return { list: jest.fn(), findById: jest.fn() };
}

describe('ListProducts', () => {
  it('returns public catalog fields with exact cents and calculated availability', async () => {
    const repo = repository();
    repo.list.mockReturnValue(okAsync([product(8)]));
    const result = await new ListProducts(repo).execute();
    expect(result.isOk()).toBe(true);
    if (result.isOk())
      expect(result.value.items).toEqual([
        {
          id,
          sku: 'AUD-001',
          category: 'audio',
          name: 'Auriculares inalámbricos Nova',
          description: 'Auriculares Bluetooth Nova.',
          imageUrl: 'https://example.test/product.png',
          unitPriceCents: 12990000,
          currency: 'COP',
          available: 8,
        },
      ]);
  });
  it('returns an empty catalog successfully', async () => {
    const repo = repository();
    repo.list.mockReturnValue(okAsync([]));
    const result = await new ListProducts(repo).execute();
    if (result.isErr()) throw new Error('Unexpected catalog error');
    expect(result.value).toEqual({ items: [] });
  });
  it('keeps sold-out products visible', async () => {
    const repo = repository();
    repo.list.mockReturnValue(okAsync([product(0)]));
    const result = await new ListProducts(repo).execute();
    if (result.isErr()) throw new Error('Unexpected catalog error');
    expect(result.value.items[0].available).toBe(0);
  });
  it('returns a typed failure when persistence is unavailable', async () => {
    const repo = repository();
    repo.list.mockReturnValue(errAsync({ kind: 'CatalogUnavailable' }));
    const result = await new ListProducts(repo).execute();
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error).toEqual({ kind: 'CatalogUnavailable' });
  });
});

describe('GetProduct', () => {
  it('retrieves the requested product', async () => {
    const repo = repository();
    repo.findById.mockReturnValue(okAsync(product()));
    const result = await new GetProduct(repo).execute(id);
    expect(repo.findById.mock.calls).toEqual([[id]]);
    if (result.isErr()) throw new Error('Unexpected catalog error');
    expect(result.value).toMatchObject({
      id,
      unitPriceCents: 12990000,
      currency: 'COP',
      available: 10,
    });
  });
  it('distinguishes a missing product from a database failure', async () => {
    const repo = repository();
    repo.findById.mockReturnValue(okAsync(null));
    const result = await new GetProduct(repo).execute(id);
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error).toEqual({ kind: 'ProductNotFound' });
  });
  it('does not treat zero availability as a missing product', async () => {
    const repo = repository();
    repo.findById.mockReturnValue(okAsync(product(0)));
    const result = await new GetProduct(repo).execute(id);
    if (result.isErr()) throw new Error('Unexpected catalog error');
    expect(result.value.available).toBe(0);
  });
  it('preserves the infrastructure error type for presentation mapping', async () => {
    const repo = repository();
    repo.findById.mockReturnValue(errAsync({ kind: 'CatalogUnavailable' }));
    const result = await new GetProduct(repo).execute(id);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('CatalogUnavailable');
  });
});
