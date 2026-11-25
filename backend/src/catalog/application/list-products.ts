import type { ResultAsync } from 'neverthrow';
import type {
  CatalogUnavailable,
  ProductRepository,
} from './product-repository';
import { ProductView, toProductView } from './product-view';

export class ListProducts {
  constructor(private readonly products: ProductRepository) {}

  execute(): ResultAsync<{ items: ProductView[] }, CatalogUnavailable> {
    return this.products
      .list()
      .map((products) => ({ items: products.map(toProductView) }));
  }
}
