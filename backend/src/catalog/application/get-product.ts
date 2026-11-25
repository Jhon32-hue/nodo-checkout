import { err, ok, ResultAsync } from 'neverthrow';
import type {
  CatalogUnavailable,
  ProductRepository,
} from './product-repository';
import { ProductView, toProductView } from './product-view';

export type ProductNotFound = { kind: 'ProductNotFound' };

export class GetProduct {
  constructor(private readonly products: ProductRepository) {}

  execute(
    id: string,
  ): ResultAsync<ProductView, ProductNotFound | CatalogUnavailable> {
    return this.products
      .findById(id)
      .andThen((product) =>
        product === null
          ? err({ kind: 'ProductNotFound' } as const)
          : ok(toProductView(product)),
      );
  }
}
