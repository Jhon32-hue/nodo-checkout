import { BadRequestException, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { errAsync, okAsync } from 'neverthrow';
import {
  CreateCheckout,
  EnsureCheckoutSession,
  GetCheckout,
  GetSummary,
  UpdateCheckout,
} from '../../application/checkout-cases';
import type { CheckoutView, Summary } from '../../domain/checkout';
import {
  CheckoutInputFilter,
  CheckoutsController,
} from './checkouts.controller';
import type { CheckoutRequest } from './session-security';
import { CryptoSessionTokens } from './session-security';

const checkoutId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const expiresAt = new Date('2030-01-02T03:04:05.000Z');
const view: CheckoutView = {
  id: checkoutId,
  productId,
  quantity: 2,
  status: 'DRAFT',
  buyer: null,
  delivery: null,
  activeTransactionId: null,
  latestTransactionId: null,
  deliveryId: null,
};
const summary: Summary = {
  quantity: 2,
  unitPriceCents: 10000,
  subtotalCents: 20000,
  baseFeeCents: 50000,
  deliveryFeeCents: 100000,
  totalCents: 170000,
  currency: 'COP',
};

function request(
  headers: Record<string, string | undefined> = {},
): CheckoutRequest {
  return {
    headers,
    checkoutSession: { id: 'owner-session', expiresAt },
  } as unknown as CheckoutRequest;
}

function response() {
  const status = jest.fn<unknown, [number]>();
  const cookie = jest.fn<unknown, [string, string, unknown]>();
  const json = jest.fn<unknown, [unknown]>();
  const value = { status, cookie, json } as unknown as Response;
  status.mockReturnValue(value);
  return {
    value,
    status,
    cookie,
    json,
  };
}

function fixture() {
  const ensure = jest
    .fn<
      ReturnType<EnsureCheckoutSession['execute']>,
      Parameters<EnsureCheckoutSession['execute']>
    >()
    .mockImplementationOnce(() =>
      okAsync({
        created: true,
        token: 'a'.repeat(64),
        csrfToken: 'csrf-test',
        session: { id: 'owner-session', expiresAt },
      }),
    );
  const create = jest
    .fn<
      ReturnType<CreateCheckout['execute']>,
      Parameters<CreateCheckout['execute']>
    >()
    .mockImplementationOnce(() => okAsync(view));
  const get = jest
    .fn<
      ReturnType<GetCheckout['execute']>,
      Parameters<GetCheckout['execute']>
    >()
    .mockImplementationOnce(() => okAsync(view));
  const update = jest
    .fn<
      ReturnType<UpdateCheckout['execute']>,
      Parameters<UpdateCheckout['execute']>
    >()
    .mockImplementationOnce(() => okAsync(view));
  const getSummary = jest
    .fn<ReturnType<GetSummary['execute']>, Parameters<GetSummary['execute']>>()
    .mockImplementationOnce(() => okAsync(summary));
  const tokens = new CryptoSessionTokens(
    'a-secure-test-secret-with-32-characters',
    ['https://store.example.test', 'http://localhost:5173'],
  );
  const controller = new CheckoutsController(
    { execute: ensure } as unknown as EnsureCheckoutSession,
    { execute: create } as unknown as CreateCheckout,
    { execute: get } as unknown as GetCheckout,
    { execute: update } as unknown as UpdateCheckout,
    { execute: getSummary } as unknown as GetSummary,
    tokens,
  );
  return { controller, ensure, create, get, update, getSummary, tokens };
}

async function httpError(operation: Promise<unknown>): Promise<HttpException> {
  const error: unknown = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(HttpException);
  if (!(error instanceof HttpException))
    throw new Error('Expected HTTP exception');
  expect(error.getResponse()).toHaveProperty('error.code');
  expect(error.getResponse()).toHaveProperty('error.message');
  return error;
}

describe('CheckoutsController', () => {
  it('creates a guest session with the complete secure cookie contract', async () => {
    const { controller, ensure } = fixture();
    const res = response();
    const req = request({ origin: 'https://store.example.test' });

    await expect(controller.session(req, res.value)).resolves.toEqual({
      data: { csrfToken: 'csrf-test', expiresAt: expiresAt.toISOString() },
    });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(undefined);
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'checkout_session',
      'a'.repeat(64),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        expires: expiresAt,
      },
    );
  });

  it('keeps localhost HTTP usable and does not replace an existing cookie', async () => {
    const { controller, ensure } = fixture();
    ensure.mockReset().mockImplementationOnce(() =>
      okAsync({
        created: false,
        token: 'b'.repeat(64),
        csrfToken: 'existing-csrf',
        session: { id: 'owner-session', expiresAt },
      }),
    );
    const res = response();
    const token = 'c'.repeat(64);
    const req = request({
      origin: 'http://localhost:5173',
      cookie: `checkout_session=${token}`,
    });

    await expect(controller.session(req, res.value)).resolves.toEqual({
      data: {
        csrfToken: 'existing-csrf',
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(token);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('sets Secure false for a newly created localhost HTTP session', async () => {
    const { controller } = fixture();
    const res = response();
    await controller.session(
      request({ origin: 'http://localhost:5173' }),
      res.value,
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'checkout_session',
      expect.any(String),
      expect.objectContaining({ secure: false }),
    );
  });

  it('rejects a body or transfer encoding on session bootstrap', async () => {
    const { controller, ensure } = fixture();
    await expect(
      controller.session(request({ 'content-length': '1' }), response().value),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.session(
        request({ 'transfer-encoding': 'chunked' }),
        response().value,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('sanitizes session persistence failures', async () => {
    const { controller, ensure } = fixture();
    ensure
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' as const }),
      );
    const error = await httpError(
      controller.session(request(), response().value),
    );
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(error.getResponse())).toContain(
      'PERSISTENCE_UNAVAILABLE',
    );
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /postgres|constraint|stack/i,
    );
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(undefined);
  });

  it('propagates the session and input to create, read, update and summary', async () => {
    const { controller, create, get, update, getSummary } = fixture();
    const req = request();
    const patch = { quantity: 3 };

    await expect(
      controller.createDraft(req, { productId, quantity: 2 }),
    ).resolves.toEqual({ data: view });
    await expect(controller.get(req, checkoutId)).resolves.toEqual({
      data: view,
    });
    await expect(controller.patch(req, checkoutId, patch)).resolves.toEqual({
      data: view,
    });
    await expect(controller.getSummary(req, checkoutId)).resolves.toEqual({
      data: summary,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('owner-session', productId, 2);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('owner-session', checkoutId);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('owner-session', checkoutId, patch);
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledWith('owner-session', checkoutId);
  });

  it('rejects invalid identifiers and empty patches before use cases', async () => {
    const { controller, get, update, getSummary } = fixture();
    const req = request();

    await expect(controller.get(req, 'not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.getSummary(req, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.patch(req, checkoutId, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(get).not.toHaveBeenCalled();
    expect(getSummary).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('maps a missing-resource result to the public 404', async () => {
    const { controller, get } = fixture();
    get
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'RESOURCE_NOT_FOUND' as const }),
      );

    const error = await httpError(controller.get(request(), checkoutId));
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      error: { code: 'RESOURCE_NOT_FOUND', message: 'RESOURCE_NOT_FOUND' },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('owner-session', checkoutId);
  });

  it('translates conflict and persistence errors without internal bodies', async () => {
    const { controller, update, getSummary } = fixture();
    update
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'CHECKOUT_LOCKED' as const }),
      );
    getSummary
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' as const }),
      );

    const conflict = await httpError(
      controller.patch(request(), checkoutId, { quantity: 2 }),
    );
    expect(conflict.getStatus()).toBe(409);
    expect(conflict.getResponse()).toEqual({
      error: { code: 'CHECKOUT_LOCKED', message: 'CHECKOUT_LOCKED' },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('owner-session', checkoutId, {
      quantity: 2,
    });
    const error = await httpError(controller.getSummary(request(), checkoutId));
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledWith('owner-session', checkoutId);
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /postgres|query|constraint|stack/i,
    );
  });

  it('normalizes validation exceptions through the input filter', () => {
    const res = response();
    const host = {
      switchToHttp: () => ({ getResponse: () => res.value }),
    } as unknown as ArgumentsHost;
    new CheckoutInputFilter().catch(new BadRequestException('private'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('private');
    expect(JSON.stringify(res.json.mock.calls[0][0])).toContain(
      'INVALID_REQUEST',
    );
  });
});
