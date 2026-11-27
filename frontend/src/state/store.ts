import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type {
  Product,
  Checkout,
  Summary,
  Attempt,
  PurchaseHistoryItem,
  Step,
} from '../types';
import { availableCart, loadCart, saveCart, type Cart } from './cart';
export interface State {
  products: Product[];
  checkout: Checkout | null;
  summary: Summary | null;
  attempt: Attempt | null;
  purchases: PurchaseHistoryItem[];
  historyLoaded: boolean;
  step: Step;
  busy: boolean;
  error: string;
  cart: Cart | null;
  selectedProductId: string | null;
  cartOpen: boolean;
  notice: string;
}
const initialState: State = {
  products: [],
  checkout: null,
  summary: null,
  attempt: null,
  purchases: [],
  historyLoaded: false,
  step: 'catalog',
  busy: false,
  error: '',
  cart: null,
  selectedProductId: null,
  cartOpen: false,
  notice: '',
};
const slice = createSlice({
  name: 'checkout',
  initialState,
  reducers: {
    products: (s, a: PayloadAction<Product[]>) => {
      s.products = a.payload;
      s.cart = availableCart(s.cart, a.payload);
    },
    checkout: (s, a: PayloadAction<Checkout | null>) => {
      s.checkout = a.payload;
    },
    summary: (s, a: PayloadAction<Summary | null>) => {
      s.summary = a.payload;
    },
    attempt: (s, a: PayloadAction<Attempt | null>) => {
      s.attempt = a.payload;
    },
    purchases: (s, a: PayloadAction<PurchaseHistoryItem[]>) => {
      s.purchases = a.payload;
      s.historyLoaded = true;
    },
    step: (s, a: PayloadAction<Step>) => {
      s.step = a.payload;
    },
    busy: (s, a: PayloadAction<boolean>) => {
      s.busy = a.payload;
    },
    error: (s, a: PayloadAction<string>) => {
      s.error = a.payload;
    },
    cart: (s, a: PayloadAction<Cart | null>) => {
      s.cart = availableCart(a.payload, s.products);
    },
    selectedProduct: (s, a: PayloadAction<string | null>) => {
      s.selectedProductId = a.payload;
    },
    cartOpen: (s, a: PayloadAction<boolean>) => {
      s.cartOpen = a.payload;
    },
    notice: (s, a: PayloadAction<string>) => {
      s.notice = a.payload;
    },
    reset: (s) => ({
      ...initialState,
      products: s.products,
      cart: s.cart,
      purchases: s.purchases,
      historyLoaded: s.historyLoaded,
    }),
  },
});
export const actions = slice.actions;
export const makeStore = () => {
  const store = configureStore({
    reducer: slice.reducer,
    preloadedState: { ...initialState, cart: loadCart() },
    devTools: false,
  });
  store.subscribe(() => saveCart(store.getState().cart));
  return store;
};
export type Store = ReturnType<typeof makeStore>;
