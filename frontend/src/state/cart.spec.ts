import { CART_KEY, loadCart, saveCart } from './cart';
import { actions, makeStore } from './store';
import { product } from '../../test/fixtures';

beforeEach(() => localStorage.clear());

it('persiste solo producto y cantidad y revalida al cargar el catálogo', () => {
  saveCart({ productId: product.id, quantity: 8 });
  const store = makeStore();
  expect(store.getState().cart?.quantity).toBe(8);
  store.dispatch(actions.products([{ ...product, available: 3 }]));
  expect(store.getState().cart?.quantity).toBe(3);
  expect(JSON.parse(localStorage.getItem(CART_KEY)!)).toEqual({
    productId: product.id,
    quantity: 3,
  });
  store.dispatch(actions.products([]));
  expect(store.getState().cart).toBeNull();
  expect(localStorage.getItem(CART_KEY)).toBeNull();
});

it('descarta datos corruptos o ajenos al carrito', () => {
  localStorage.setItem(
    CART_KEY,
    JSON.stringify({ productId: product.id, quantity: 1, cardToken: 'secret' }),
  );
  expect(loadCart()).toBeNull();
  localStorage.setItem(
    CART_KEY,
    JSON.stringify({ productId: product.id, quantity: 100 }),
  );
  expect(loadCart()).toBeNull();
});
