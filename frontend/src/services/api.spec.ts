import { api, ApiError } from './api';
import { summary, config } from '../../test/fixtures';
function response(data: unknown, ok = true) {
  return { ok, json: async () => data } as Response;
}
beforeEach(() => {
  globalThis.fetch = jest.fn();
  Object.defineProperty(AbortSignal, 'timeout', {
    value: () => new AbortController().signal,
    configurable: true,
  });
});
it('conserva sesión/CSRF, cuerpos mínimos y clave de creación', async () => {
  const mock = jest.mocked(fetch);
  mock.mockResolvedValue(response({ data: { csrfToken: 'csrf-fixture' } }));
  await api.session();
  mock.mockResolvedValue(response({ data: { items: [] } }));
  expect(await api.products()).toEqual([]);
  await api.createCheckout('id', 1);
  await api.checkout('id');
  await api.patch(
    'id',
    { fullName: 'Name', email: 'a@b.co', phone: '+57123' },
    {
      recipientName: 'Name',
      phone: '+57123',
      addressLine1: 'abc',
      city: 'city',
      region: 'region',
      country: 'CO',
    },
  );
  await api.summary('id');
  await api.config();
  await api.createAttempt('id', summary, 'key');
  await api.attempt('attempt');
  await api.purchases();
  await api.pay('attempt', 'transient', config, {
    policy: true,
    personal: true,
  });
  await api.sync('attempt');
  expect(mock).toHaveBeenCalledWith(
    '/api/v1/transactions',
    expect.objectContaining({
      headers: expect.objectContaining({
        'Idempotency-Key': 'key',
        'X-CSRF-Token': 'csrf-fixture',
      }),
      credentials: 'same-origin',
    }),
  );
  const createAttemptCall = mock.mock.calls.find(
    ([url, options]) =>
      url === '/api/v1/transactions' && options?.method === 'POST',
  );
  const body = JSON.parse(String(createAttemptCall?.[1]?.body));
  expect(body.acceptedSummary).not.toHaveProperty('totalCents');
  expect(mock.mock.calls.at(-1)?.[1]).not.toHaveProperty('body');
});
it('sanitiza transporte, JSON, esquemas y error HTTP sin copiar mensajes', async () => {
  const mock = jest.mocked(fetch);
  mock.mockRejectedValueOnce(new Error('secret-network'));
  await expect(api.products()).rejects.toEqual(new ApiError('NETWORK'));
  mock.mockResolvedValueOnce({
    ok: true,
    json: async () => {
      throw Error('secret-json');
    },
  } as unknown as Response);
  await expect(api.products()).rejects.toEqual(
    new ApiError('INVALID_RESPONSE'),
  );
  mock.mockResolvedValueOnce(response({}));
  await expect(api.products()).rejects.toEqual(
    new ApiError('INVALID_RESPONSE'),
  );
  mock.mockResolvedValueOnce(
    response({ error: { code: 'secret message', message: 'secret' } }, false),
  );
  await expect(api.products()).rejects.toEqual(new ApiError('UNAVAILABLE'));
  mock.mockResolvedValueOnce(
    response({ error: { code: 'SUMMARY_CHANGED' } }, false),
  );
  await expect(api.products()).rejects.toEqual(new ApiError('SUMMARY_CHANGED'));
});
