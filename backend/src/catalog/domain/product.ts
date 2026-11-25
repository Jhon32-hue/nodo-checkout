import type { Money } from '../../shared/domain/money';
import type { ProductCategory } from './product-category';

export interface Product {
  readonly id: string;
  readonly sku: string;
  readonly category: ProductCategory | null;
  readonly name: string;
  readonly description: string;
  readonly imageUrl: string;
  readonly unitPrice: Money;
  readonly available: number;
}
