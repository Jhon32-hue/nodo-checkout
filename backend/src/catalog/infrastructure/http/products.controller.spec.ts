import {
  BadRequestException,
  HttpException,
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
  const list = jest.fn<
    ReturnType<ListProducts['execute']>,
    Parameters<ListProducts['execute']>
  >();
  const get = jest.fn<
    ReturnType<GetProduct['execute']>,
    Parameters<GetProduct['execute']>
  >();
  list.mockReturnValueOnce(okAsync({ items: [product] }));
  get.mockReturnValueOnce(okAsync(product));
  const controller = new ProductsController(
    { execute: list } as unknown as ListProducts,
    { execute: get } as unknown as GetProduct,
  );
  return { controller, list, get };
}

async function httpError(operation: Promise<unknown>): Promise<HttpException> {
  const error: unknown = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(HttpException);
  if (!(error instanceof HttpException))
    throw new Error('Expected HTTP exception');
  return error;
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
    expect(list).toHaveBeenCalledWith();
    expect(get).toHaveBeenCalledTimes(1);
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
    get
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'ProductNotFound' as const }),
      );

    const error = await httpError(controller.get(product.id, {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado.' },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(product.id);
  });

  it('maps list and detail persistence failures to the same safe 503', async () => {
    const { controller, list, get } = fixture();
    list
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'CatalogUnavailable' as const }),
      );
    get
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'CatalogUnavailable' as const }),
      );

    for (const operation of [
      controller.list({}),
      controller.get(product.id, {}),
    ]) {
      const error = await httpError(operation);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getStatus()).toBe(503);
      const publicBody = JSON.stringify(error.getResponse());
      expect(publicBody).toContain('CATALOG_UNAVAILABLE');
      expect(publicBody).not.toMatch(/query|postgres|constraint|stack/i);
    }
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(product.id);
  });
});
