import { Flow } from './flow';
import { makeStore, actions } from './store';
import { loadProgress, saveProgress, STORAGE_KEY } from './progress';
import { ApiError, type Api } from '../services/api';
import {
  product,
  checkout,
  buyer,
  delivery,
  summary,
  attempt,
  config,
  card,
} from '../../test/fixtures';
function fixture() {
  localStorage.clear();
  const store = makeStore();
  const api: jest.Mocked<Api> = {
    products: jest.fn().mockResolvedValue([product]),
    session: jest.fn().mockResolvedValue(undefined),
    createCheckout: jest.fn().mockResolvedValue(checkout),
    checkout: jest.fn().mockResolvedValue(checkout),
    patch: jest.fn().mockResolvedValue({ ...checkout, buyer, delivery }),
    summary: jest.fn().mockResolvedValue(summary),
    config: jest.fn().mockResolvedValue(config),
    createAttempt: jest.fn().mockResolvedValue(attempt),
    attempt: jest.fn().mockResolvedValue(attempt),
    purchases: jest.fn().mockResolvedValue([
      {
        id: attempt.id,
        checkoutId: checkout.id,
        productName: product.name,
        quantity: 1,
        totalCents: summary.totalCents,
        currency: 'COP',
        reference: 'pc_fixture',
        status: 'APPROVED',
        dispatchStatus: 'SUBMITTED',
        createdAt: '2026-11-26T16:33:46.796Z',
        deliveryId: '44444444-4444-4444-8444-444444444444',
      },
    ]),
    pay: jest
      .fn()
      .mockResolvedValue({ ...attempt, dispatchStatus: 'SUBMITTED' }),
    sync: jest.fn().mockResolvedValue({
      ...attempt,
      status: 'APPROVED',
      dispatchStatus: 'SUBMITTED',
    }),
  };
  const token = jest.fn().mockResolvedValue('transient-card-token');
  const flow = new Flow(store, api, token);
  return { store, api, token, flow };
}
async function prepared(f: ReturnType<typeof fixture>) {
  await f.flow.initialize();
  await f.flow.begin(product.id, 1);
  await f.flow.configuration();
  await f.flow.details(buyer, delivery, card, { policy: true, personal: true });
}
it('muestra el resumen del servidor antes de tokenizar o crear un intento', async () => {
  const f = fixture();
  await prepared(f);
  expect(f.store.getState().step).toBe('summary');
  expect(f.store.getState().summary).toEqual(summary);
  expect(f.api.summary).toHaveBeenCalledWith(checkout.id);
  expect(f.token).not.toHaveBeenCalled();
  expect(f.api.createAttempt).not.toHaveBeenCalled();
  expect(f.api.pay).not.toHaveBeenCalled();
  await f.flow.confirm();
  expect(f.token).toHaveBeenCalledTimes(1);
  expect(f.api.pay).toHaveBeenCalledTimes(1);
});
it('conserva el resumen sin crear cobro cuando falla la tokenización', async () => {
  const f = fixture();
  await prepared(f);
  f.token.mockRejectedValueOnce(new ApiError('TOKENIZATION'));
  await f.flow.confirm();
  expect(f.store.getState().step).toBe('summary');
  expect(f.store.getState().summary).toEqual(summary);
  expect(f.api.createAttempt).not.toHaveBeenCalled();
  expect(f.api.pay).not.toHaveBeenCalled();
});
it('permite recalcular el resumen al editar un borrador recuperado', async () => {
  const f = fixture();
  await prepared(f);
  f.flow.invalidateSummary();
  expect(f.store.getState().summary).toBeNull();
  await f.flow.details(buyer, delivery, card, { policy: true, personal: true });
  expect(f.store.getState().step).toBe('summary');
  expect(f.store.getState().summary).toEqual(summary);
  expect(f.token).not.toHaveBeenCalled();
});
it('lista y abre una compra de la sesiÃ³n sin crear, pagar ni sincronizar', async () => {
  const f = fixture();
  await f.flow.history();
  const item = f.store.getState().purchases[0];
  expect(item?.status).toBe('APPROVED');
  expect(f.api.session).toHaveBeenCalledTimes(1);
  expect(f.api.purchases).toHaveBeenCalledTimes(1);
  await f.flow.openPurchase(item!);
  expect(f.store.getState()).toMatchObject({
    checkout: {
      id: checkout.id,
      productId: checkout.productId,
      quantity: checkout.quantity,
      status: checkout.status,
    },
    attempt,
    step: 'result',
  });
  expect(loadProgress()).toMatchObject({
    checkoutId: checkout.id,
    transactionId: attempt.id,
    step: 'result',
  });
  expect(f.api.createAttempt).not.toHaveBeenCalled();
  expect(f.api.pay).not.toHaveBeenCalled();
  expect(f.api.sync).not.toHaveBeenCalled();
});
describe('Compra y recuperación sin reenviar pagos', () => {
  it('bloquea saltos y conserva la navegación válida sin crear intentos', async () => {
    const f = fixture();
    await f.flow.initialize();
    expect(f.flow.navigation('summary').enabled).toBe(false);
    expect(f.flow.navigation('result').enabled).toBe(false);
    f.flow.navigate('result');
    expect(f.store.getState().step).toBe('catalog');
    await prepared(f);
    expect(f.flow.navigation('summary').enabled).toBe(true);
    f.flow.navigate('details');
    f.flow.navigate('catalog');
    f.flow.navigate('summary');
    expect(f.store.getState().step).toBe('summary');
    expect(f.api.createAttempt).not.toHaveBeenCalled();
    expect(f.api.pay).not.toHaveBeenCalled();
    f.flow.invalidateSummary();
    expect(f.flow.navigation('summary').enabled).toBe(false);
    expect(f.store.getState().summary).toBeNull();
    f.flow.navigate('summary');
    expect(f.store.getState().step).toBe('summary');
    f.flow.navigate('details');
    expect(f.store.getState().step).toBe('details');
  });
  it('no convierte un resultado incierto en pago completo ni permite editarlo', async () => {
    const f = fixture();
    await prepared(f);
    f.api.pay.mockRejectedValue(new ApiError('NETWORK'));
    f.api.attempt.mockResolvedValue({ ...attempt, dispatchStatus: 'UNKNOWN' });
    await f.flow.confirm();
    expect(f.flow.navigation('details').enabled).toBe(false);
    expect(f.flow.navigation('result').completed).toBe(false);
    expect(f.flow.navigation('summary').enabled).toBe(true);
    f.flow.navigate('details');
    expect(f.store.getState().step).toBe('result');
    f.flow.navigate('summary');
    await f.flow.confirm();
    expect(f.api.pay).toHaveBeenCalledTimes(1);
  });
  it('solo permite revisar el resumen histórico después de aprobación', async () => {
    const f = fixture();
    await prepared(f);
    await f.flow.confirm();
    f.store.dispatch(
      actions.attempt({
        ...attempt,
        status: 'APPROVED',
        dispatchStatus: 'SUBMITTED',
      }),
    );
    expect(f.flow.navigation('details').enabled).toBe(false);
    expect(f.flow.navigation('summary').enabled).toBe(true);
    expect(f.flow.navigation('result').completed).toBe(true);
    f.flow.navigate('summary');
    expect(f.store.getState().step).toBe('summary');
    f.flow.navigate('details');
    expect(f.store.getState().step).toBe('summary');
    expect(f.api.pay).toHaveBeenCalledTimes(1);
  });
  it('completa el flujo, serializa doble clic y no envía tarjeta a Redux o storage', async () => {
    const f = fixture();
    await prepared(f);
    await Promise.all([f.flow.confirm(), f.flow.confirm()]);
    expect(f.api.createAttempt).toHaveBeenCalledTimes(1);
    expect(f.api.pay).toHaveBeenCalledTimes(1);
    expect(f.api.createAttempt).toHaveBeenCalledWith(
      checkout.id,
      summary,
      expect.any(String),
    );
    expect(f.token).toHaveBeenCalledWith(card, config);
    const saved = JSON.stringify({
      state: f.store.getState(),
      storage: localStorage.getItem(STORAGE_KEY),
    });
    for (const secret of [
      card.number,
      '"cvc":',
      '"cardToken":',
      'transient-card-token',
      'policy-fixture',
      'personal-fixture',
    ])
      expect(saved).not.toContain(secret);
    expect(f.store.getState().step).toBe('result');
    f.api.attempt.mockResolvedValue({
      ...attempt,
      dispatchStatus: 'SUBMITTED',
    });
    await f.flow.sync();
    expect(f.store.getState().attempt?.status).toBe('APPROVED');
    await f.flow.back();
    expect(f.store.getState().checkout).toBeNull();
    expect(loadProgress()).toEqual({ step: 'catalog' });
  });
  it('mantiene datos sensibles fuera de Redux, acciones y storage', async () => {
    sessionStorage.clear();
    const f = fixture();
    const dispatch = jest.spyOn(f.store, 'dispatch');
    await prepared(f);
    const observableBrowserState = JSON.stringify({
      redux: f.store.getState(),
      actions: dispatch.mock.calls,
      localStorage: Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index)!;
          return [key, localStorage.getItem(key)];
        }),
      ),
      sessionStorage: Object.fromEntries(
        Array.from({ length: sessionStorage.length }, (_, index) => {
          const key = sessionStorage.key(index)!;
          return [key, sessionStorage.getItem(key)];
        }),
      ),
    });
    for (const forbidden of [
      card.number,
      card.cvc,
      card.holder,
      buyer.email,
      buyer.phone,
      delivery.addressLine1,
      config.publicKey,
      config.tokenizationPublicKey,
      config.acceptance.acceptanceToken,
      config.acceptance.personalAuthToken,
      'transient-card-token',
    ])
      expect(observableBrowserState).not.toContain(forbidden);
    expect(sessionStorage.length).toBe(0);
    expect(f.flow.checkoutDraft(checkout.id)).toEqual({
      checkoutId: checkout.id,
      buyer,
      delivery,
    });
  });
  it('recupera IDs de backend tras refresh sin pay ni tokenización', async () => {
    const f = fixture();
    saveProgress({
      checkoutId: checkout.id,
      step: 'summary',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });
    f.api.checkout.mockResolvedValue({
      ...checkout,
      activeTransactionId: attempt.id,
      status: 'PAYMENT_PENDING',
    });
    f.api.attempt.mockResolvedValue({ ...attempt, dispatchStatus: 'UNKNOWN' });
    const flow = new Flow(f.store, f.api, f.token);
    await flow.initialize();
    expect(f.store.getState().step).toBe('catalog');
    await flow.recover();
    expect(f.store.getState().step).toBe('result');
    expect(f.api.pay).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
    await flow.begin(product.id, 1);
    expect(f.api.createCheckout).not.toHaveBeenCalled();
    await flow.back();
    expect(loadProgress().transactionId).toBe(attempt.id);
  });
  it('muestra el intento guardado aunque fallen catálogo y resumen al recargar', async () => {
    const f = fixture();
    saveProgress({
      checkoutId: checkout.id,
      transactionId: attempt.id,
      step: 'result',
    });
    f.api.products.mockRejectedValue(new ApiError('NETWORK'));
    f.api.summary.mockRejectedValue(new ApiError('NETWORK'));
    f.api.attempt.mockResolvedValue({ ...attempt, dispatchStatus: 'UNKNOWN' });
    const flow = new Flow(f.store, f.api, f.token);
    await flow.initialize();
    expect(f.api.checkout).toHaveBeenCalledWith(checkout.id);
    expect(f.api.attempt).toHaveBeenCalledWith(attempt.id);
    expect(f.api.summary).not.toHaveBeenCalled();
    expect(f.store.getState().step).toBe('catalog');
    await flow.recover();
    expect(f.store.getState().step).toBe('result');
    expect(f.store.getState().attempt?.dispatchStatus).toBe('UNKNOWN');
    expect(f.api.pay).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
    expect(loadProgress().transactionId).toBe(attempt.id);
  });
  it('recupera NOT_SENT pidiendo tarjeta otra vez, sin depender del token perdido', async () => {
    const f = fixture();
    saveProgress({
      checkoutId: checkout.id,
      transactionId: attempt.id,
      step: 'result',
    });
    const flow = new Flow(f.store, f.api, f.token);
    await flow.initialize();
    expect(f.store.getState().step).toBe('catalog');
    await flow.recover();
    expect(f.store.getState().step).toBe('details');
    await flow.confirm();
    expect(f.api.pay).not.toHaveBeenCalled();
    expect(f.store.getState().step).toBe('details');
    await flow.configuration();
    await flow.details(buyer, delivery, card, { policy: true, personal: true });
    await flow.confirm();
    expect(f.api.createAttempt).not.toHaveBeenCalled();
    expect(f.api.pay).toHaveBeenCalledTimes(1);
  });
  it('restaura borrador y maneja resumen incompleto', async () => {
    const f = fixture();
    saveProgress({ checkoutId: checkout.id, step: 'details' });
    f.api.summary.mockRejectedValue(new ApiError('INCOMPLETE_CHECKOUT'));
    const flow = new Flow(f.store, f.api, f.token);
    await flow.initialize();
    expect(f.store.getState().checkout).toEqual({
      id: checkout.id,
      productId: checkout.productId,
      quantity: checkout.quantity,
      status: checkout.status,
      activeTransactionId: checkout.activeTransactionId,
      latestTransactionId: checkout.latestTransactionId,
      deliveryId: checkout.deliveryId,
    });
    expect(f.store.getState().summary).toBeNull();
    expect(f.store.getState().step).toBe('catalog');
    await flow.recover();
    expect(f.store.getState().step).toBe('details');
    await flow.begin(product.id, 1);
    expect(f.api.createCheckout).not.toHaveBeenCalled();
  });
  it('conserva la clave ante respuesta perdida de creación y solo paga tras acción explícita', async () => {
    const f = fixture();
    await prepared(f);
    f.api.createAttempt.mockRejectedValueOnce(new ApiError('NETWORK'));
    await f.flow.confirm();
    const key = loadProgress().idempotencyKey;
    expect(f.api.pay).not.toHaveBeenCalled();
    await f.flow.confirm();
    expect(f.api.createAttempt.mock.calls.map((c) => c[2])).toEqual([key, key]);
    expect(f.api.pay).toHaveBeenCalledTimes(1);
  });
  it('SUMMARY_CHANGED exige nueva confirmación y resumen actualizado', async () => {
    const f = fixture();
    await prepared(f);
    f.api.createAttempt.mockRejectedValueOnce(new ApiError('SUMMARY_CHANGED'));
    f.api.summary.mockResolvedValue({ ...summary, totalCents: 14000000 });
    await f.flow.confirm();
    expect(f.store.getState().summary?.totalCents).toBe(14000000);
    expect(f.store.getState().error).toContain('importes');
    expect(f.api.pay).not.toHaveBeenCalled();
    expect(loadProgress().idempotencyKey).toBeUndefined();
    await f.flow.confirm();
    expect(f.api.pay).toHaveBeenCalledTimes(1);
  });
  it('respuesta pay perdida consulta estado y nunca reenvía; UNKNOWN retiene compra', async () => {
    const f = fixture();
    await prepared(f);
    f.api.pay.mockRejectedValue(new ApiError('NETWORK'));
    f.api.attempt.mockResolvedValue({ ...attempt, dispatchStatus: 'UNKNOWN' });
    await f.flow.confirm();
    expect(f.api.attempt).toHaveBeenCalledWith(attempt.id);
    expect(f.store.getState().attempt?.dispatchStatus).toBe('UNKNOWN');
    await f.flow.confirm();
    expect(f.api.pay).toHaveBeenCalledTimes(1);
    await f.flow.sync();
    expect(f.api.pay).toHaveBeenCalledTimes(1);
  });
  it('fallo al consultar tras pay mantiene ID durable y resultado consultable', async () => {
    const f = fixture();
    await prepared(f);
    f.api.pay.mockRejectedValue(new ApiError('NETWORK'));
    f.api.attempt.mockRejectedValue(new ApiError('NETWORK'));
    await f.flow.confirm();
    expect(loadProgress().transactionId).toBe(attempt.id);
    expect(f.store.getState().step).toBe('result');
  });
  it('no envía con configuración o consentimiento ausentes ni cantidad inválida', async () => {
    const f = fixture();
    await f.flow.initialize();
    await f.flow.begin(product.id, 0);
    expect(f.api.createCheckout).not.toHaveBeenCalled();
    await f.flow.begin(product.id, 1);
    await f.flow.details(buyer, delivery, card, {
      policy: false,
      personal: true,
    });
    expect(f.token).not.toHaveBeenCalled();
    await f.flow.details(buyer, delivery, card, {
      policy: true,
      personal: true,
    });
    expect(f.token).not.toHaveBeenCalled();
  });
  it('no parchea compra reservada y recupera resumen histórico', async () => {
    const f = fixture();
    saveProgress({
      checkoutId: checkout.id,
      transactionId: attempt.id,
      step: 'details',
    });
    f.api.checkout.mockResolvedValue({
      ...checkout,
      status: 'PAYMENT_PENDING',
    });
    f.api.attempt.mockResolvedValue({ ...attempt, summary: undefined });
    const flow = new Flow(f.store, f.api, f.token);
    await flow.initialize();
    await flow.configuration();
    await flow.details(buyer, delivery, card, { policy: true, personal: true });
    expect(f.api.patch).not.toHaveBeenCalled();
    flow.edit();
    flow.close();
    expect(f.store.getState().step).toBe('catalog');
    await flow.recover();
    expect(f.api.session).toHaveBeenCalledTimes(2);
  });
  it('terminal previo nunca se reutiliza, y sync NOT_SENT es lectura sin proveedor', async () => {
    const f = fixture();
    await prepared(f);
    await f.flow.confirm();
    f.store.dispatch(
      actions.attempt({
        ...attempt,
        status: 'APPROVED',
        dispatchStatus: 'SUBMITTED',
      }),
    );
    await f.flow.confirm();
    expect(f.api.pay).toHaveBeenCalledTimes(1);
    await f.flow.sync();
    expect(f.api.sync).not.toHaveBeenCalled();
  });
  it('valida almacenamiento y falla cerrado si no puede persistir', () => {
    localStorage.clear();
    expect(loadProgress()).toEqual({ step: 'catalog' });
    localStorage.setItem(STORAGE_KEY, 'invalid json');
    expect(loadProgress()).toEqual({ step: 'catalog' });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ step: 'summary', cardToken: 'forbidden' }),
    );
    expect(loadProgress()).toEqual({ step: 'catalog' });
    const broken = {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
    } as unknown as Storage;
    expect(loadProgress(broken)).toEqual({ step: 'catalog' });
    expect(() => saveProgress({ step: 'catalog' }, broken)).toThrow();
  });
});

it('no sobrescribe IDs si falla la recuperación de sesión tras refresh', async () => {
  localStorage.clear();
  saveProgress({
    checkoutId: checkout.id,
    transactionId: attempt.id,
    step: 'result',
  });
  const f = fixture();
  saveProgress({
    checkoutId: checkout.id,
    transactionId: attempt.id,
    step: 'result',
  });
  f.api.session.mockRejectedValue(new ApiError('UNAUTHORIZED'));
  const flow = new Flow(f.store, f.api, f.token);
  await flow.initialize();
  await flow.begin(product.id, 1);
  expect(f.api.createCheckout).not.toHaveBeenCalled();
  expect(loadProgress().transactionId).toBe(attempt.id);
});

it.each(['RESOURCE_NOT_FOUND', 'SESSION_REQUIRED'])(
  'separa un checkout local inaccesible (%s) del carrito y crea uno nuevo solo por acción explícita',
  async (recoveryError) => {
    const f = fixture();
    const staleCheckoutId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const freshCheckout = {
      ...checkout,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    saveProgress({
      checkoutId: staleCheckoutId,
      transactionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      step: 'result',
    });
    f.store.dispatch(actions.products([product]));
    f.store.dispatch(actions.cart({ productId: product.id, quantity: 1 }));
    f.api.checkout.mockRejectedValueOnce(new ApiError(recoveryError));
    f.api.createCheckout.mockResolvedValueOnce(freshCheckout);

    const flow = new Flow(f.store, f.api, f.token);
    await flow.initialize();

    expect(f.store.getState()).toMatchObject({
      cart: { productId: product.id, quantity: 1 },
      checkout: null,
      attempt: null,
      error: '',
    });
    expect(f.store.getState().recoveryWarning).toContain(
      'pertenece a otra sesión',
    );
    expect(loadProgress()).toMatchObject({
      checkoutId: staleCheckoutId,
      transactionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(f.api.createCheckout).not.toHaveBeenCalled();
    expect(f.api.pay).not.toHaveBeenCalled();
    expect(f.api.sync).not.toHaveBeenCalled();

    await flow.begin(product.id, 1);

    expect(f.api.createCheckout).toHaveBeenCalledTimes(1);
    expect(f.store.getState().checkout?.id).toBe(freshCheckout.id);
    expect(f.store.getState().cart).toEqual({
      productId: product.id,
      quantity: 1,
    });
    expect(f.store.getState().recoveryWarning).toBe('');
    expect(loadProgress()).toEqual({
      checkoutId: freshCheckout.id,
      step: 'details',
    });
    expect(f.api.pay).not.toHaveBeenCalled();
    expect(f.api.sync).not.toHaveBeenCalled();
  },
);

it('un error del historial no bloquea catálogo, carrito ni una compra nueva', async () => {
  const f = fixture();
  await f.flow.initialize();
  f.store.dispatch(actions.cart({ productId: product.id, quantity: 1 }));
  f.api.purchases.mockRejectedValueOnce(new ApiError('SESSION_REQUIRED'));

  await f.flow.history();

  expect(f.store.getState().historyError).toContain('sesión');
  expect(f.store.getState().error).toBe('');
  expect(f.store.getState().products).toEqual([product]);
  expect(f.store.getState().cart).toEqual({
    productId: product.id,
    quantity: 1,
  });

  await f.flow.begin(product.id, 1);
  expect(f.api.createCheckout).toHaveBeenCalledTimes(1);
  expect(f.store.getState().step).toBe('details');
  expect(f.api.pay).not.toHaveBeenCalled();
  expect(f.api.sync).not.toHaveBeenCalled();
});
