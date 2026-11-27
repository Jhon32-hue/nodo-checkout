import { tokenize, normalizePem, UAT } from './tokenize';
import { card, config } from '../../test/fixtures';
import { EncryptJWT, importSPKI } from 'jose';
beforeEach(() => {
  globalThis.fetch = jest.fn();
  Object.defineProperty(AbortSignal, 'timeout', {
    value: () => new AbortController().signal,
    configurable: true,
  });
});
it('normaliza PEM de una línea y envía solo JWE al proveedor UAT', async () => {
  const fetcher = jest.mocked(fetch);
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { id: 'fixture-token' } }),
  } as Response);
  expect(await tokenize(card, config)).toBe('fixture-token');
  expect(importSPKI).toHaveBeenCalledWith(
    '-----BEGIN PUBLIC KEY-----\nYWJj\n-----END PUBLIC KEY-----',
    'RSA-OAEP-256',
  );
  expect(EncryptJWT).toHaveBeenCalledWith(
    expect.objectContaining({
      exp_year: '35',
      exp_month: '12',
      card_holder: card.holder,
    }),
  );
  expect(fetcher.mock.calls[0][0]).toBe(UAT + '/v1/tokens/cards');
  const sent = String(fetcher.mock.calls[0][1]?.body);
  expect(JSON.parse(sent)).toEqual({ payload: 'encrypted-fixture' });
  expect(sent).not.toContain(card.number);
  expect(sent).not.toContain(card.cvc);
});
it('rechaza host, ambiente o llave no sandbox sin enviar datos', async () => {
  for (const patch of [
    { environment: 'PRODUCTION' },
    { tokenizationUrl: 'https://other.test' },
    { publicKey: 'pub_prod_fixture' },
  ])
    await expect(
      tokenize(card, { ...config, ...patch } as typeof config),
    ).rejects.toMatchObject({ code: 'TOKENIZATION' });
  expect(fetch).not.toHaveBeenCalled();
  expect(() => normalizePem('not a key!')).toThrow();
});
it.each(['token-http', 'token-json', 'network'])(
  'sanitiza %s sin cuerpo ni secreto',
  async (mode) => {
    const mock = jest.mocked(fetch);
    if (mode === 'network') mock.mockRejectedValue(new Error('secret'));
    else
      mock.mockResolvedValueOnce({
        ok: mode !== 'token-http',
        json: async () => ({
          data: { id: mode === 'token-json' ? '' : undefined },
        }),
      } as Response);
    await expect(tokenize(card, config)).rejects.toMatchObject({
      code:
        mode === 'network'
          ? 'TOKENIZATION_NETWORK'
          : mode === 'token-json'
            ? 'TOKENIZATION_INVALID_RESPONSE'
            : 'TOKENIZATION',
      message: 'No pudimos completar la solicitud.',
    });
  },
);
it('clasifica solo la validación 422 del número como tarjeta Sandbox no admitida', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 422,
    json: async () => ({
      error: {
        type: 'INPUT_VALIDATION_ERROR',
        messages: { number: ['external detail must stay private'] },
      },
    }),
  } as Response);
  await expect(tokenize(card, config)).rejects.toEqual(
    expect.objectContaining({
      code: 'SANDBOX_CARD_NOT_ALLOWED',
      message: 'No pudimos completar la solicitud.',
    }),
  );
});
it('no confunde otros 422 ni fallos del proveedor con una tarjeta no admitida', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 422,
    json: async () => ({
      error: {
        type: 'INPUT_VALIDATION_ERROR',
        messages: { exp_month: ['external detail must stay private'] },
      },
    }),
  } as Response);
  await expect(tokenize(card, config)).rejects.toMatchObject({
    code: 'TOKENIZATION',
    reason: 'http',
  });
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ error: 'external detail must stay private' }),
  } as Response);
  await expect(tokenize(card, config)).rejects.toMatchObject({
    code: 'GATEWAY_UNAVAILABLE',
    reason: 'http',
  });
});
it('rechaza una clave de cifrado ausente sin enviar tarjeta', async () => {
  await expect(
    tokenize(card, { ...config, tokenizationPublicKey: '' }),
  ).rejects.toMatchObject({
    code: 'TOKENIZATION',
    stage: 'key',
    reason: 'schema',
    message: 'No pudimos completar la solicitud.',
  });
  expect(fetch).not.toHaveBeenCalled();
});
