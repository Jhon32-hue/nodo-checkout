import type { ResultAsync } from 'neverthrow';
import type { Product } from '../domain/product';

export type CatalogUnavailable = { kind: 'CatalogUnavailable' };
export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

export interface ProductRepository {
  list(): ResultAsync<readonly Product[], CatalogUnavailable>;
  findById(id: string): ResultAsync<Product | null, CatalogUnavailable>;
}
