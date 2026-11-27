import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { Provider } from 'react-redux';
import { App } from './App';
import { makeStore, actions } from './state/store';
import type { Flow } from './state/flow';
import { checkout, product, summary, attempt, config } from '../test/fixtures';
it('conecta catálogo, compra, resumen y resultado con Redux sin pagar por montaje', async () => {
  const store = makeStore();
  const f = {
    initialize: jest.fn(),
    checkoutDraft: jest.fn().mockReturnValue(null),
    begin: jest.fn(),
    recover: jest.fn(),
    history: jest.fn(),
    openPurchase: jest.fn(),
    back: jest.fn(),
    close: jest.fn(),
    edit: jest.fn(),
    confirm: jest.fn(),
    canConfirm: jest.fn().mockReturnValue(true),
    configuration: jest.fn().mockResolvedValue(config),
    sync: jest.fn(),
    discardLocalDraft: jest.fn().mockReturnValue(false),
    completeApprovedTransition: jest.fn(),
    finishApprovedTransition: jest.fn(),
    navigate: jest.fn(),
    navigation: jest
      .fn()
      .mockReturnValue({ enabled: true, reason: '', completed: false }),
  } as unknown as Flow;
  render(
    <Provider store={store}>
      <App flow={f} />
    </Provider>,
  );
  expect(f.initialize).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Mis compras' }));
  expect(f.history).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('heading', { name: 'Mis compras' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Volver a la tienda' }));
  expect(f.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Volver a consultar catálogo'));
  expect(f.initialize).toHaveBeenCalledTimes(2);
  await act(async () => {
    store.dispatch(actions.products([product]));
  });
  jest.mocked(Element.prototype.scrollIntoView).mockClear();
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Buscar productos' }),
    {
      target: { value: 'producto inexistente' },
    },
  );
  const searchbox = screen.getByRole('searchbox', {
    name: 'Buscar productos',
  });
  searchbox.focus();
  expect(screen.getByText(/No encontramos productos/)).not.toHaveFocus();
  expect(searchbox).toHaveFocus();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('searchbox').closest('form')!);
  await waitFor(() =>
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    }),
  );
  const emptyResults = screen.getByText(
    'No encontramos productos para esta búsqueda.',
  );
  expect(emptyResults).toHaveFocus();
  expect(
    screen.queryByText('0 productos encontrados.'),
  ).not.toBeInTheDocument();
  expect(searchbox).toHaveValue('producto inexistente');
  expect(f.begin).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.sync).not.toHaveBeenCalled();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockReturnValue({ matches: true }),
  });
  fireEvent.change(searchbox, { target: { value: product.name } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await waitFor(() =>
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
    }),
  );
  expect(
    screen.getByRole('heading', { name: 'Todos los productos' }),
  ).toHaveFocus();
  expect(screen.getByText('1 producto encontrado.')).toBeInTheDocument();
  expect(searchbox).toHaveValue(product.name);
  expect(f.begin).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.sync).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Buscar productos' }),
    { target: { value: '' } },
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver detalle de ' + product.name }),
  );
  expect(
    screen.getByRole('heading', { name: product.name }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Pagar con tarjeta de crédito' }),
  );
  expect(f.begin).toHaveBeenCalledWith(product.id, 1);
  await act(async () => {
    store.dispatch(actions.checkout(checkout));
    store.dispatch(actions.step('details'));
  });
  expect(await screen.findByText('Tarjeta de crédito')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Producto,/ }));
  expect(screen.getByText('PRODUCTO DE ESTA COMPRA')).toBeInTheDocument();
  expect(screen.queryByText(product.description)).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(f.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Volver al checkout' }));
  expect(screen.getByText('Tarjeta de crédito')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Cerrar'));
  expect(f.close).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await act(async () => {
    store.dispatch(actions.summary(summary));
    store.dispatch(actions.step('summary'));
  });
  expect(f.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Confirmar y pagar/));
  expect(f.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Volver a tarjeta y entrega'));
  expect(f.edit).toHaveBeenCalled();
  await act(async () => {
    store.dispatch(actions.attempt({ ...attempt, status: 'APPROVED' }));
    store.dispatch(actions.step('result'));
  });
  expect(screen.getByText('Compra confirmada')).toBeInTheDocument();
  await act(async () => {
    store.dispatch(actions.error('Error sanitizado'));
    store.dispatch(actions.step('catalog'));
    store.dispatch(
      actions.attempt({ ...attempt, dispatchStatus: 'IN_FLIGHT' }),
    );
  });
  fireEvent.click(screen.getByText('Consultar estado'));
  fireEvent.click(screen.getByText('Recuperar estado de mi compra'));
  expect(f.recover).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/Estamos enviando tu pago/)).toBeInTheDocument();
  await act(async () => {
    store.dispatch(actions.attempt(null));
    store.dispatch(actions.error(''));
    store.dispatch(actions.busy(true));
    store.dispatch(actions.products([]));
  });
  expect(
    screen.getByRole('status', { name: 'Consultando la colección' }),
  ).toBeInTheDocument();
});

it('carrito conserva varios productos en orden y no inicia checkout al agregar', async () => {
  localStorage.clear();
  const store = makeStore();
  const second = {
    ...product,
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Otro producto',
  };
  const f = {
    initialize: jest.fn(),
    checkoutDraft: jest.fn().mockReturnValue(null),
    begin: jest.fn(),
    configuration: jest.fn().mockResolvedValue(config),
  } as unknown as Flow;
  render(
    <Provider store={store}>
      <App flow={f} />
    </Provider>,
  );
  await act(async () => store.dispatch(actions.products([product, second])));
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver detalle de ' + product.name }),
  );
  fireEvent.click(screen.getByText('Agregar al carrito'));
  expect(store.getState().cart.items).toEqual([
    { productId: product.id, quantity: 1 },
  ]);
  expect(f.begin).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Cerrar carrito'));
  fireEvent.click(screen.getByText(/Volver al catálogo/));
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver detalle de Otro producto' }),
  );
  fireEvent.click(screen.getByText('Agregar al carrito'));
  expect(store.getState().cart.items).toEqual([
    { productId: product.id, quantity: 1 },
    { productId: second.id, quantity: 1 },
  ]);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(f.begin).not.toHaveBeenCalled();
});

it('filtra localmente por categoría, permite volver a todos y agrega desde la tarjeta', async () => {
  localStorage.clear();
  const store = makeStore();
  const keyboard = {
    ...product,
    id: '44444444-4444-4444-8444-444444444444',
    sku: 'COM-001',
    category: 'computacion',
    name: 'Teclado de prueba',
  };
  const f = {
    initialize: jest.fn(),
    checkoutDraft: jest.fn().mockReturnValue(null),
    begin: jest.fn(),
  } as unknown as Flow;
  render(
    <Provider store={store}>
      <App flow={f} />
    </Provider>,
  );
  await act(async () => store.dispatch(actions.products([product, keyboard])));
  expect(
    screen.getAllByRole('button', { name: /Ver detalle de/ }),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver Computación, 1 producto' }),
  );
  expect(
    screen.getAllByRole('button', { name: /Ver detalle de/ }),
  ).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Ver detalle de Teclado de prueba' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
  expect(
    screen.getAllByRole('button', { name: /Ver detalle de/ }),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: `Agregar ${product.name} al carrito` }),
  );
  expect(store.getState().cart).toEqual({
    items: [{ productId: product.id, quantity: 1 }],
  });
  expect(screen.getByText('Producto agregado al carrito.')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Cerrar carrito'));
  await act(async () =>
    store.dispatch(
      actions.cart({
        items: [{ productId: product.id, quantity: product.available }],
      }),
    ),
  );
  fireEvent.click(
    screen.getByRole('button', { name: `Agregar ${product.name} al carrito` }),
  );
  expect(store.getState().cart.items[0]?.quantity).toBe(product.available);
  expect(store.getState().notice).toContain(
    'Ya tienes todas las unidades disponibles',
  );
  expect(f.begin).not.toHaveBeenCalled();
});

it('muestra navegación móvil accesible y conserva el aviso de compra sin abrir tarjeta', async () => {
  const store = makeStore();
  const f = {
    initialize: jest.fn(),
    recover: jest.fn(),
    checkoutDraft: jest.fn().mockReturnValue(null),
  } as unknown as Flow;
  render(
    <Provider store={store}>
      <App flow={f} />
    </Provider>,
  );
  await act(async () => {
    store.dispatch(actions.products([product]));
    store.dispatch(actions.checkout(checkout));
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.getByText('Tienes una compra sin terminar.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
  expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  fireEvent.click(screen.getByRole('link', { name: 'Categorías' }));
  expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(f.recover).toHaveBeenCalledTimes(1);
});

it('informa el progreso inaccesible y conserva el carrito para iniciar otra compra', async () => {
  localStorage.clear();
  const store = makeStore();
  const f = {
    initialize: jest.fn(),
    begin: jest.fn(),
    checkoutDraft: jest.fn().mockReturnValue(null),
  } as unknown as Flow;
  render(
    <Provider store={store}>
      <App flow={f} />
    </Provider>,
  );
  await act(async () => {
    store.dispatch(actions.products([product]));
    store.dispatch(
      actions.cart({ items: [{ productId: product.id, quantity: 1 }] }),
    );
    store.dispatch(
      actions.recoveryWarning(
        'No pudimos recuperar una compra anterior porque pertenece a otra sesión o la sesión venció. La compra permanece registrada. Puedes iniciar una nueva compra.',
      ),
    );
  });

  expect(store.getState().cart).toEqual({
    items: [{ productId: product.id, quantity: 1 }],
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Iniciar una nueva compra' }),
  );
  expect(f.begin).toHaveBeenCalledWith(product.id, 1);
  expect(f.confirm).toBeUndefined();
});
