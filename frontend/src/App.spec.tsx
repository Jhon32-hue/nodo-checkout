import { render, screen, fireEvent, act } from '@testing-library/react';
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
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(f.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Volver a consultar catálogo'));
  expect(f.initialize).toHaveBeenCalledTimes(2);
  await act(async () => {
    store.dispatch(actions.products([product]));
  });
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
  fireEvent.click(screen.getByLabelText('Cerrar'));
  expect(f.close).toHaveBeenCalled();
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
  expect(screen.getByText('Compra aprobada')).toBeInTheDocument();
  await act(async () => {
    store.dispatch(actions.error('Error sanitizado'));
    store.dispatch(actions.step('catalog'));
    store.dispatch(actions.attempt(attempt));
  });
  fireEvent.click(screen.getByText('Ver estado'));
  fireEvent.click(screen.getByText('Recuperar estado de mi compra'));
  expect(f.recover).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Tienes un pago pendiente/)).toBeInTheDocument();
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

it('carrito pide confirmar reemplazo y no inicia checkout al agregar', async () => {
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
  expect(store.getState().cart?.productId).toBe(product.id);
  expect(f.begin).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Volver al catálogo/));
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver detalle de Otro producto' }),
  );
  fireEvent.click(screen.getByText('Agregar al carrito'));
  expect(screen.getByText(/reemplazar el actual/)).toBeInTheDocument();
  expect(store.getState().cart?.productId).toBe(product.id);
  fireEvent.click(screen.getByText('Conservar el actual'));
  expect(store.getState().cart?.productId).toBe(product.id);
  fireEvent.click(screen.getByText('Agregar al carrito'));
  fireEvent.click(screen.getByText('Sí, reemplazar'));
  expect(store.getState().cart?.productId).toBe(second.id);
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
  expect(store.getState().cart).toEqual({ productId: product.id, quantity: 1 });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Producto agregado al carrito.',
  );
  await act(async () =>
    store.dispatch(
      actions.cart({ productId: product.id, quantity: product.available }),
    ),
  );
  fireEvent.click(
    screen.getByRole('button', { name: `Agregar ${product.name} al carrito` }),
  );
  expect(store.getState().cart?.quantity).toBe(product.available);
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
  expect(screen.getByText('Tienes una compra pendiente')).toBeInTheDocument();
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
    store.dispatch(actions.cart({ productId: product.id, quantity: 1 }));
    store.dispatch(
      actions.recoveryWarning(
        'No pudimos recuperar una compra anterior porque pertenece a otra sesión o la sesión venció. La compra permanece registrada. Puedes iniciar una nueva compra.',
      ),
    );
  });

  expect(store.getState().cart).toEqual({
    productId: product.id,
    quantity: 1,
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Iniciar una nueva compra' }),
  );
  expect(f.begin).toHaveBeenCalledWith(product.id, 1);
  expect(f.confirm).toBeUndefined();
});
