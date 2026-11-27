import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errAsync, okAsync } from 'neverthrow';
import { GetProduct } from '../../application/get-product';
import { ListProducts } from '../../application/list-products';
import type { ProductView } from '../../application/product-view';
import { ProductsController } from './products.controller';

const product: ProductView = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'AUD-001',
  category: 'audio',
  name: 'Auriculares',
  description: 'Producto de prueba',
  imageUrl: 'https://example.test/product.png',
  unitPriceCents: 12990000,
  currency: 'COP',
  available: 3,
};

function fixture() {
  const list = jest.fn(() => okAsync({ items: [product] }));
  const get = jest.fn(() => okAsync(product));
  const controller = new ProductsController(
    { execute: list } as unknown as ListProducts,
    { execute: get } as unknown as GetProduct,
  );
  return { controller, list, get };
}

describe('ProductsController', () => {
  it('returns the catalog and product without changing public values', async () => {
    const { controller, list, get } = fixture();

    await expect(controller.list({})).resolves.toEqual({
      data: { items: [product] },
    });
    await expect(controller.get(product.id, {})).resolves.toEqual({
      data: product,
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(product.id);
  });

  it('rejects every unsupported query before calling a use case', async () => {
    const { controller, list, get } = fixture();

    await expect(controller.list({ limit: '10' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.get(product.id, { cursor: 'private' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('maps missing products to a sanitized 404', async () => {
    const { controller, get } = fixture();
    get.mockImplementation(() =>
      errAsync({ kind: 'ProductNotFound' as const }),
    );

    await expect(controller.get(product.id, {})).rejects.toMatchObject({
      status: 404,
    });
    try {
      await controller.get(product.id, {});
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect(
        JSON.stringify((error as NotFoundException).getResponse()),
      ).not.toMatch(/query|postgres|stack|session/i);
    }
  });

  it('maps list and detail persistence failures to the same safe 503', async () => {
    const { controller, list, get } = fixture();
    list.mockImplementation(() =>
      errAsync({ kind: 'CatalogUnavailable' as const }),
    );
    get.mockImplementation(() =>
      errAsync({ kind: 'CatalogUnavailable' as const }),
    );

    for (const operation of [
      controller.list({}),
      controller.get(product.id, {}),
    ]) {
      await expect(operation).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await operation.catch((error: ServiceUnavailableException) => {
        const publicBody = JSON.stringify(error.getResponse());
        expect(publicBody).toContain('CATALOG_UNAVAILABLE');
        expect(publicBody).not.toMatch(/query|postgres|constraint|stack/i);
      });
    }
  });
});
