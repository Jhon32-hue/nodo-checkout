import { z } from 'zod';
import type { Product } from '../types';

const schema = z
  .object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) })
  .strict();
export type Cart = z.infer<typeof schema>;
export const CART_KEY = 'nodo.cart.v1';

export function loadCart(storage: Storage = window.localStorage): Cart | null {
  try {
    const parsed = schema.safeParse(
      JSON.parse(storage.getItem(CART_KEY) ?? 'null'),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveCart(
  cart: Cart | null,
  storage: Storage = window.localStorage,
) {
  try {
    if (cart) storage.setItem(CART_KEY, JSON.stringify(schema.parse(cart)));
    else storage.removeItem(CART_KEY);
  } catch {
    // The cart remains usable in memory when storage is unavailable.
  }
}

export function availableCart(
  cart: Cart | null,
  products: Product[],
): Cart | null {
  if (!cart) return null;
  const product = products.find((p) => p.id === cart.productId);
  if (!product || product.available < 1) return null;
  return {
    productId: cart.productId,
    quantity: Math.min(cart.quantity, product.available, 99),
  };
}
