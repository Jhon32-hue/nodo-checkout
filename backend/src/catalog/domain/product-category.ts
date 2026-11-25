export const PRODUCT_CATEGORIES = [
  'audio',
  'computacion',
  'accesorios',
  'almacenamiento',
  'hogar-inteligente',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return PRODUCT_CATEGORIES.some((category) => category === value);
}
