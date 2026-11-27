import type { Product } from './types';

export const categoryNames: Record<string, string> = {
  audio: 'Audio',
  computacion: 'Computación',
  accesorios: 'Accesorios',
  almacenamiento: 'Almacenamiento',
  'hogar-inteligente': 'Hogar inteligente',
};

export const categories = [
  { id: 'audio', imageSku: 'AUD-001' },
  { id: 'computacion', imageSku: 'COM-001' },
  { id: 'accesorios', imageSku: 'ACC-002' },
  { id: 'almacenamiento', imageSku: 'ALM-001' },
  { id: 'hogar-inteligente', imageSku: 'HOG-001' },
] as const;

export type Category = (typeof categories)[number]['id'];
export type CategoryFilter = Category | 'all';

const imagesBySku: Record<string, string> = {
  'AUD-001': '/images/products/aud-001.jpeg',
  'AUD-002': '/images/products/aud-002.jpeg',
  'COM-001': '/images/products/com-001.jpeg',
  'COM-002': '/images/products/com-002.jpeg',
  'COM-003': '/images/products/com-003.jpeg',
  'ACC-001': '/images/products/acc-001.jpeg',
  'ACC-002': '/images/products/acc-002.jpeg',
  'ALM-001': '/images/products/alm-001.jpeg',
  'HOG-001': '/images/products/hog-001.jpeg',
  'HOG-002': '/images/products/hog-002.jpeg',
};

export function productImage(product: Product): string {
  return imagesBySku[product.sku] ?? product.imageUrl;
}

export function categoryImage(sku: string): string {
  return imagesBySku[sku];
}

export function filterProducts(products: Product[], filter: CategoryFilter) {
  return filter === 'all'
    ? products
    : products.filter((product) => product.category === filter);
}
