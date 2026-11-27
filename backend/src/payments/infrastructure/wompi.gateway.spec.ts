import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  decodeObservation,
  integritySignature,
  WompiPaymentGateway,
  UAT_ORIGIN,
} from './wompi.gateway';
import type { PaymentDiagnostic } from './wompi.gateway';
import type { PayInput, PaymentRecord } from '../domain/payment';
const env = {
  baseUrl: UAT_ORIGIN + '/v1/',
  publicKey: 'pub_test_fixture',
  privateKey: 'prv_test_fixture',
  integritySecret: 'unit-secret',
};
const tokenizationPublicKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
}).publicKey.export({ type: 'spki', format: 'pem' });
const body = {
  data: {
    id: '123-456-789',
    reference: 'pc_reference',
    amount_in_cents: 100,
    currency: 'COP',
    status: 'PENDING',
  },
};
function token(id: number, hash = 'file', exp?: number) {
  return [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        contract_id: id,
        file_hash: hash,
        permalink: 'https://example.test/contract' + id,
        ...(exp === undefined ? {} : { exp }),
      }),
    ).toString('base64url'),
    'signature',
  ].join('.');
}
const policy = () => ({
  acceptance_token: token(1),
  permalink: 'https://example.test/contract1',
  type: 'END_USER_POLICY',
});
const personal = () => ({
  acceptance_token: token(2),
  permalink: 'https://example.test/contract2',
  type: 'PERSONAL_DATA_AUTH',
});
const config = () => ({
  data: {
    presigned_acceptance: policy(),
    presigned_personal_data_auth: personal(),
  },
});
function input(): PayInput {
  return {
    cardToken: 'opaque-token',
    installments: 1,
    acceptance: {
      acceptanceToken: token(1),
      personalAuthToken: token(2),
      policyAccepted: true,
      personalDataAccepted: true,
    },
  };
}
const record: PaymentRecord = {
  view: {
    id: 'local',
    checkoutId: 'checkout',
    status: 'PENDING',
    dispatchStatus: 'IN_FLIGHT',
    reservationExpiresAt: new Date().toISOString(),
    deliveryId: null,
  },
  reference: 'pc_reference',
  amountCents: 100,
  currency: 'COP',
  quantity: 1,
  buyer: {
    fullName: 'Buyer',
    email: 'buyer@example.test',
    phone: '+573000000000',
  },
  environment: 'UAT_SANDBOX',
  providerId: null,
  payHash: 'hash',
  startedAt: new Date(),
  reservationStatus: 'HELD',
  expiresAt: new Date(),
};
function mock(value: unknown, status = 200) {
  return jest.fn((request: string | URL | Request, init?: RequestInit) => {
    void init;
    const url =
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    const response = url.endsWith('/v1/tokens/keys/tokenization')
      ? { data: { publicKey: tokenizationPublicKey } }
      : value;
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  });
}
describe('Wompi runtime decoding and sanitized transport', () => {
  it.each(['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'])(
    'decodes %s with owned types',
    (status) => {
      const r = decodeObservation({ data: { ...body.data, status } });
      expect(r.isOk() && r.value.status).toBe(status);
    },
  );
  it.each([
    undefined,
    null,
    [],
    {},
    { data: null },
    { data: [] },
    { data: { ...body.data, id: 'bad/id' } },
    { data: { ...body.data, id: null } },
    { data: { ...body.data, reference: '' } },
    { data: { ...body.data, amount_in_cents: '100' } },
    { data: { ...body.data, amount_in_cents: 1.5 } },
    { data: { ...body.data, currency: 'USD' } },
    { data: { ...body.data, status: 'NEW_STATUS' } },
  ])('rejects incomplete/unknown response %p', (value) => {
    expect(decodeObservation(value).isErr()).toBe(true);
  });
  it('classifies missing and null data as invalid schema without forwarding body values', () => {
    const absent = decodeObservation({}),
      nil = decodeObservation({ data: null });
    expect(absent.isErr() && absent.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'creation',
      reason: 'schema',
    });
    expect(nil.isErr() && nil.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'creation',
      reason: 'schema',
    });
  });
  it('gets both contracts, sends public header and exposes only public fields', async () => {
    const http = mock(config());
    const r = await new WompiPaymentGateway(env, http).configuration();
    expect(r.isOk() && r.value).toEqual({
      environment: 'UAT_SANDBOX',
      publicKey: env.publicKey,
      tokenizationPublicKey: tokenizationPublicKey.toString().trim(),
      tokenizationUrl: UAT_ORIGIN + '/v1/tokens/cards',
      installments: 1,
      acceptance: {
        acceptanceToken: token(1),
        personalAuthToken: token(2),
        policyUrl: policy().permalink,
        personalDataUrl: personal().permalink,
      },
    });
    expect(http.mock.calls[0][0]).toBe(UAT_ORIGIN + '/v1/merchants/info');
    expect(http.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { 'x-merchant-public-key': env.publicKey },
    });
    expect(http.mock.calls[1][0]).toBe(
      UAT_ORIGIN + '/v1/tokens/keys/tokenization',
    );
    expect(http.mock.calls[1][1]).toMatchObject({
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + env.publicKey,
        'Content-Type': 'application/json',
      },
    });
    expect(http.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    { data: {} },
    { data: { presigned_acceptance: policy() } },
    {
      data: {
        presigned_acceptance: { ...policy(), permalink: 'http://unsafe.test' },
        presigned_personal_data_auth: personal(),
      },
    },
  ])('rejects invalid contracts', async (value) => {
    expect(
      (await new WompiPaymentGateway(env, mock(value)).configuration()).isErr(),
    ).toBe(true);
  });
  it.each([undefined, null, '', 'not-a-key'])(
    'rejects invalid tokenization public key %p',
    async (publicKey) => {
      const http = jest.fn((request: string | URL | Request) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              (typeof request === 'string'
                ? request
                : request instanceof URL
                  ? request.href
                  : request.url
              ).endsWith('/v1/tokens/keys/tokenization')
                ? { data: { publicKey } }
                : config(),
            ),
            { status: 200 },
          ),
        ),
      );
      const result = await new WompiPaymentGateway(env, http).configuration();
      expect(result.isErr() && result.error).toEqual({
        kind: 'GATEWAY_UNAVAILABLE',
        operation: 'configuration',
        reason: 'schema',
        httpStatus: 200,
      });
    },
  );
  it('accepts matching current contracts and rejects modified/expired tokens without rewriting tokens', async () => {
    const gateway = new WompiPaymentGateway(env, mock(config()));
    expect((await gateway.validateAcceptance(input())).isOk()).toBe(true);
    for (const changed of ['bad', token(1, 'different'), token(1, 'file', 1)]) {
      const p = input();
      p.acceptance.acceptanceToken = changed;
      const r = await gateway.validateAcceptance(p);
      expect(r.isErr() && r.error.kind).toBe('INVALID_ACCEPTANCE');
    }
  });
  it('does not mistake invalid merchant JWT metadata for valid acceptance', async () => {
    const cfg = config();
    cfg.data.presigned_acceptance.acceptance_token = 'not-jwt';
    const r = await new WompiPaymentGateway(env, mock(cfg)).validateAcceptance(
      input(),
    );
    expect(r.isErr() && r.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'configuration',
      reason: 'schema',
      httpStatus: 200,
    });
  });
  it('signs server history and maps both acceptance fields without a retry', async () => {
    const http = mock(body);
    const p = input();
    p.cardToken = ' opaque with spaces ';
    const r = await new WompiPaymentGateway(env, http).create({
      record,
      input: p,
    });
    expect(r.isOk()).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
    const raw = http.mock.calls[0][1]?.body;
    if (typeof raw !== 'string') throw new Error('Expected JSON request body');
    const sent: unknown = JSON.parse(raw);
    expect(sent).toMatchObject({
      reference: record.reference,
      amount_in_cents: 100,
      currency: 'COP',
      customer_email: record.buyer.email,
      payment_method: {
        type: 'CARD',
        token: ' opaque with spaces ',
        installments: 1,
      },
      acceptance_token: p.acceptance.acceptanceToken,
      accept_personal_auth: p.acceptance.personalAuthToken,
      signature: createHash('sha256')
        .update('pc_reference100COPunit-secret')
        .digest('hex'),
    });
    expect(http.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer ' + env.privateKey,
    });
    expect(
      integritySignature('pc_reference', 100, 'COP', 'unit-secret'),
    ).not.toBe(integritySignature('pc_reference', 101, 'COP', 'unit-secret'));
  });
  it('authenticates lookup privately and rejects unsafe IDs without sending', async () => {
    const http = mock(body),
      g = new WompiPaymentGateway(env, http);
    expect((await g.get('123-456-789')).isOk()).toBe(true);
    expect(http.mock.calls[0][0]).toBe(
      UAT_ORIGIN + '/v1/transactions/123-456-789',
    );
    for (const id of ['../foreign', '.', '..'])
      expect((await g.get(id)).isErr()).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each([301, 400, 401, 404, 422, 500])(
    'sanitizes HTTP %s without disclosing provider content',
    async (status) => {
      const r = await new WompiPaymentGateway(
        env,
        mock({ error: { message: 'sensitive provider details' } }, status),
      ).create({ record, input: input() });
      expect(r.isErr() && r.error).toEqual({
        kind: 'GATEWAY_UNAVAILABLE',
        operation: 'creation',
        reason: 'http',
        httpStatus: status,
      });
    },
  );
  it('sanitizes transport and invalid JSON failures', async () => {
    const http: typeof fetch = () =>
      Promise.reject(new Error('contains secret'));
    const a = await new WompiPaymentGateway(env, http).get('id');
    expect(a.isErr() && a.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'query',
      reason: 'transport',
    });
    const invalid: typeof fetch = () =>
      Promise.resolve(new Response('invalid json'));
    const b = await new WompiPaymentGateway(env, invalid).get('id');
    expect(b.isErr() && b.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'query',
      reason: 'json',
      httpStatus: 200,
    });
  });
  it.each([
    { ...env, baseUrl: 'https://production.wompi.co/v1' },
    { ...env, publicKey: 'pub_prod_fixture' },
    { ...env, privateKey: undefined },
    { ...env, integritySecret: '' },
  ])(
    'refuses unsupported or missing environment configuration',
    async (configuration) => {
      const http = mock(body);
      expect(
        (await new WompiPaymentGateway(configuration, http).get('id')).isErr(),
      ).toBe(true);
      expect(http).not.toHaveBeenCalled();
    },
  );
  it('rejects inconsistent displayed contract links instead of accepting a different document', async () => {
    const cfg = config();
    cfg.data.presigned_acceptance.permalink =
      'https://example.test/different-policy';
    const result = await new WompiPaymentGateway(
      env,
      mock(cfg),
    ).validateAcceptance(input());
    expect(result.isErr() && result.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'configuration',
      reason: 'schema',
      httpStatus: 200,
    });
  });
});

describe('Payment diagnostics allowlist', () => {
  it.each(['transport', 'http', 'json', 'schema'] as const)(
    'retains creation %s metadata but no sensitive contents',
    async (reason) => {
      const diagnostic = jest.fn<void, [PaymentDiagnostic]>();
      const secrets = [
        input().cardToken,
        input().acceptance.acceptanceToken,
        input().acceptance.personalAuthToken,
        env.privateKey,
        env.integritySecret,
        record.buyer.email,
        record.buyer.fullName,
        record.buyer.phone,
        'secret-pan-cvc',
      ];
      const http: typeof fetch =
        reason === 'transport'
          ? () => Promise.reject(new Error(secrets.join(' ')))
          : () =>
              Promise.resolve(
                new Response(
                  reason === 'json'
                    ? secrets.join(' ')
                    : JSON.stringify({
                        data: {
                          id: 'unvalidated-id',
                          secret: secrets.join(' '),
                        },
                      }),
                  { status: reason === 'http' ? 422 : 201 },
                ),
              );
      const result = await new WompiPaymentGateway(
        env,
        http,
        8000,
        diagnostic,
      ).create({ record, input: input() });
      expect(result.isErr() && result.error).toEqual({
        kind: 'GATEWAY_UNAVAILABLE',
        operation: 'creation',
        reason,
        ...(reason === 'transport'
          ? {}
          : { httpStatus: reason === 'http' ? 422 : 201 }),
      });
      expect(diagnostic).toHaveBeenCalledTimes(2);
      expect(diagnostic.mock.calls[0][0]).toMatchObject({
        event: 'provider.request.started',
        operation: 'creation',
        transactionId: 'local',
        reference: 'pc_reference',
      });
      expect(diagnostic.mock.calls[1][0]).toMatchObject({
        event:
          reason === 'transport'
            ? 'provider.request.failed'
            : 'provider.response.received',
        operation: 'creation',
        transactionId: 'local',
        reference: 'pc_reference',
        errorCode: 'GATEWAY_' + reason.toUpperCase(),
        ...(reason === 'transport'
          ? {}
          : { providerHttpStatus: reason === 'http' ? 422 : 201 }),
      });
      const serialized = JSON.stringify({
        result,
        diagnostics: diagnostic.mock.calls,
      });
      for (const secret of secrets) expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain('unvalidated-id');
    },
  );
  it('logs a validated remote ID before any SQL finalization and correlates query', async () => {
    const diagnostic = jest.fn<void, [PaymentDiagnostic]>();
    const g = new WompiPaymentGateway(env, mock(body, 201), 8000, diagnostic);
    await g.create({ record, input: input() });
    await g.get(body.data.id, { localId: 'local', reference: 'pc_reference' });
    const events = diagnostic.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.event)).toEqual([
      'provider.request.started',
      'provider.response.received',
      'provider.request.started',
      'provider.response.received',
    ]);
    expect(events[1]).toMatchObject({
      operation: 'creation',
      errorCode: 'VALIDATED',
      providerHttpStatus: 201,
      transactionId: 'local',
      reference: 'pc_reference',
    });
    expect(events[1].providerTransactionFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(events[3]).toMatchObject({
      operation: 'query',
      errorCode: 'VALIDATED',
      providerHttpStatus: 201,
      providerTransactionFingerprint: events[1].providerTransactionFingerprint,
    });
    expect(JSON.stringify(events)).not.toContain(body.data.id);
  });
  it('identifies configuration failure without sending or exposing environment values', async () => {
    const diagnostic = jest.fn<void, [PaymentDiagnostic]>(),
      http = mock(body);
    const result = await new WompiPaymentGateway(
      {},
      http,
      8000,
      diagnostic,
    ).configuration();
    expect(result.isErr() && result.error).toEqual({
      kind: 'GATEWAY_UNAVAILABLE',
      operation: 'configuration',
      reason: 'configuration',
    });
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provider.request.failed',
        operation: 'configuration',
        errorCode: 'GATEWAY_CONFIGURATION',
      }),
    );
    expect(http).not.toHaveBeenCalled();
  });
});
