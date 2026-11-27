import {
  CART_KEY,
  addCartItem,
  loadCart,
  removeCartItem,
  saveCart,
} from './cart';
import { actions, makeStore } from './store';
import { product } from '../../test/fixtures';

beforeEach(() => localStorage.clear());

it('persiste varios productos, migra el formato anterior y revalida existencias', () => {
  saveCart({ items: [{ productId: product.id, quantity: 8 }] });
  const store = makeStore();
  expect(store.getState().cart.items[0]?.quantity).toBe(8);
  store.dispatch(actions.products([{ ...product, available: 3 }]));
  expect(store.getState().cart.items[0]?.quantity).toBe(3);
  expect(JSON.parse(localStorage.getItem(CART_KEY)!)).toEqual({
    items: [{ productId: product.id, quantity: 3 }],
  });
  store.dispatch(actions.products([]));
  expect(store.getState().cart.items).toEqual([]);
  expect(localStorage.getItem(CART_KEY)).toBeNull();

  localStorage.setItem(
    CART_KEY,
    JSON.stringify({ productId: product.id, quantity: 2 }),
  );
  expect(loadCart()).toEqual({
    items: [{ productId: product.id, quantity: 2 }],
  });
});

it('agrega productos distintos en orden, acumula cantidades y elimina solo el indicado', () => {
  const second = { ...product, id: '44444444-4444-4444-8444-444444444444' };
  let cart = addCartItem(
    { items: [] },
    { productId: product.id, quantity: 1 },
    [product, second],
  );
  cart = addCartItem(cart, { productId: second.id, quantity: 2 }, [
    product,
    second,
  ]);
  cart = addCartItem(cart, { productId: product.id, quantity: 2 }, [
    product,
    second,
  ]);
  expect(cart.items).toEqual([
    { productId: product.id, quantity: 3 },
    { productId: second.id, quantity: 2 },
  ]);
  expect(removeCartItem(cart, product.id).items).toEqual([
    { productId: second.id, quantity: 2 },
  ]);
});

it('descarta datos corruptos o ajenos al carrito', () => {
  localStorage.setItem(
    CART_KEY,
    JSON.stringify({
      items: [{ productId: product.id, quantity: 1, cardToken: 'secret' }],
    }),
  );
  expect(loadCart()).toEqual({ items: [] });
  localStorage.setItem(
    CART_KEY,
    JSON.stringify({ items: [{ productId: product.id, quantity: 100 }] }),
  );
  expect(loadCart()).toEqual({ items: [] });
});
