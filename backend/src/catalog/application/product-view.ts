import type { Product } from '../domain/product';
import type { ProductCategory } from '../domain/product-category';

export interface ProductView {
  id: string;
  sku: string;
  category: ProductCategory | null;
  name: string;
  description: string;
  imageUrl: string;
  unitPriceCents: number;
  currency: 'COP';
  available: number;
}

export function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    sku: product.sku,
    category: product.category,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    unitPriceCents: product.unitPrice.cents,
    currency: product.unitPrice.currency,
    available: product.available,
  };
}
