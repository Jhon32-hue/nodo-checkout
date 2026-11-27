import { z } from 'zod';
import type { Product } from '../types';

const itemSchema = z
  .object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) })
  .strict();
const schema = z.object({ items: z.array(itemSchema).max(20) }).strict();
const legacySchema = itemSchema;
export type CartItem = z.infer<typeof itemSchema>;
export type Cart = z.infer<typeof schema>;
export const CART_KEY = 'nodo.cart.v1';

export function loadCart(storage: Storage = window.localStorage): Cart {
  try {
    const raw: unknown = JSON.parse(storage.getItem(CART_KEY) ?? 'null');
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const legacy = legacySchema.safeParse(raw);
    return legacy.success ? { items: [legacy.data] } : { items: [] };
  } catch {
    return { items: [] };
  }
}

export function saveCart(cart: Cart, storage: Storage = window.localStorage) {
  try {
    if (cart.items.length)
      storage.setItem(CART_KEY, JSON.stringify(schema.parse(cart)));
    else storage.removeItem(CART_KEY);
  } catch {
    // The cart remains usable in memory when storage is unavailable.
  }
}

export function availableCart(cart: Cart, products: Product[]): Cart {
  return {
    items: cart.items.flatMap((item) => {
      const product = products.find(
        (candidate) => candidate.id === item.productId,
      );
      return !product || product.available < 1
        ? []
        : [
            {
              ...item,
              quantity: Math.min(item.quantity, product.available, 99),
            },
          ];
    }),
  };
}

export const cartUnits = (cart: Cart) =>
  cart.items.reduce((total, item) => total + item.quantity, 0);

export function addCartItem(
  cart: Cart,
  item: CartItem,
  products: Product[],
): Cart {
  const product = products.find((candidate) => candidate.id === item.productId);
  if (!product || product.available < 1) return cart;
  const current = cart.items.find(
    (candidate) => candidate.productId === item.productId,
  );
  const quantity = Math.min(
    (current?.quantity ?? 0) + item.quantity,
    product.available,
    99,
  );
  return availableCart(
    {
      items: current
        ? cart.items.map((candidate) =>
            candidate.productId === item.productId
              ? { ...candidate, quantity }
              : candidate,
          )
        : [...cart.items, { ...item, quantity }],
    },
    products,
  );
}

export const updateCartItem = (
  cart: Cart,
  productId: string,
  quantity: number,
) => ({
  items: cart.items.map((item) =>
    item.productId === productId ? { ...item, quantity } : item,
  ),
});

export const removeCartItem = (cart: Cart, productId: string) => ({
  items: cart.items.filter((item) => item.productId !== productId),
});
