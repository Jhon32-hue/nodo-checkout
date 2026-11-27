import type {
  Product,
  Buyer,
  Delivery,
  Checkout,
  Summary,
  Attempt,
  PurchaseHistoryItem,
  Config,
  Consent,
} from '../types';
export class ApiError extends Error {
  constructor(public readonly code: string) {
    super('No pudimos completar la solicitud.');
  }
}
let csrf = '';
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('NETWORK');
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('INVALID_RESPONSE');
  }
  if (!response.ok)
    throw new ApiError(
      typeof json?.error?.code === 'string' && /^[A-Z_]+$/.test(json.error.code)
        ? json.error.code
        : 'UNAVAILABLE',
    );
  if (!json || !Object.hasOwn(json, 'data'))
    throw new ApiError('INVALID_RESPONSE');
  return json.data as T;
}
export const api = {
  products: () =>
    request<{ items: Product[] }>('GET', '/products').then((d) => d.items),
  session: async () => {
    const data = await request<{ csrfToken: string }>(
      'POST',
      '/checkout-sessions',
    );
    csrf = data.csrfToken;
  },
  createCheckout: (productId: string, quantity: number) =>
    request<Checkout>('POST', '/checkouts', { productId, quantity }),
  checkout: (id: string) => request<Checkout>('GET', '/checkouts/' + id),
  patch: (id: string, buyer: Buyer, delivery: Delivery) =>
    request<Checkout>('PATCH', '/checkouts/' + id, { buyer, delivery }),
  summary: (id: string) =>
    request<Summary>('GET', '/checkouts/' + id + '/summary'),
  config: () => request<Config>('GET', '/payments/config'),
  createAttempt: (checkoutId: string, s: Summary, key: string) =>
    request<Attempt>(
      'POST',
      '/transactions',
      {
        checkoutId,
        acceptedSummary: {
          quantity: s.quantity,
          unitPriceCents: s.unitPriceCents,
          baseFeeCents: s.baseFeeCents,
          deliveryFeeCents: s.deliveryFeeCents,
          currency: s.currency,
        },
      },
      { 'Idempotency-Key': key },
    ),
  attempt: (id: string) => request<Attempt>('GET', '/transactions/' + id),
  purchases: () =>
    request<{ items: PurchaseHistoryItem[] }>('GET', '/transactions').then(
      (data) => data.items,
    ),
  pay: (id: string, cardToken: string, c: Config, consent: Consent) =>
    request<Attempt>('POST', '/transactions/' + id + '/pay', {
      cardToken,
      installments: 1,
      acceptance: {
        acceptanceToken: c.acceptance.acceptanceToken,
        personalAuthToken: c.acceptance.personalAuthToken,
        policyAccepted: consent.policy,
        personalDataAccepted: consent.personal,
      },
    }),
  sync: (id: string) =>
    request<Attempt>('POST', '/transactions/' + id + '/sync'),
};
export type Api = typeof api;
