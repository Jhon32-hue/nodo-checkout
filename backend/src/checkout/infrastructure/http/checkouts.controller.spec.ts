import { BadRequestException } from '@nestjs/common';
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
  const ensure = jest.fn(() =>
    okAsync({
      created: true,
      token: 'a'.repeat(64),
      csrfToken: 'csrf-test',
      session: { id: 'owner-session', expiresAt },
    }),
  );
  const create = jest.fn(() => okAsync(view));
  const get = jest.fn(() => okAsync(view));
  const update = jest.fn(() => okAsync(view));
  const getSummary = jest.fn(() => okAsync(summary));
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

describe('CheckoutsController', () => {
  it('creates a guest session with the complete secure cookie contract', async () => {
    const { controller, ensure } = fixture();
    const res = response();
    const req = request({ origin: 'https://store.example.test' });

    await expect(controller.session(req, res.value)).resolves.toEqual({
      data: { csrfToken: 'csrf-test', expiresAt: expiresAt.toISOString() },
    });
    expect(ensure).toHaveBeenCalledWith(undefined);
    expect(res.status).toHaveBeenCalledWith(201);
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
    ensure.mockImplementation(() =>
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
    ensure.mockImplementation(() =>
      errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' as const }),
    );
    await expect(
      controller.session(request(), response().value),
    ).rejects.toMatchObject({ status: 503 });
    await controller
      .session(request(), response().value)
      .catch((error: unknown) => {
        expect(JSON.stringify(error)).not.toMatch(/postgres|constraint|stack/i);
      });
  });

  it('passes the owner and validated values to create, read, update and summary', async () => {
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
    expect(create).toHaveBeenCalledWith('owner-session', productId, 2);
    expect(get).toHaveBeenCalledWith('owner-session', checkoutId);
    expect(update).toHaveBeenCalledWith('owner-session', checkoutId, patch);
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

  it('returns the same 404 for a foreign or nonexistent checkout', async () => {
    const { controller, get } = fixture();
    get.mockImplementation(() =>
      errAsync({ kind: 'RESOURCE_NOT_FOUND' as const }),
    );

    const first = controller
      .get(request(), checkoutId)
      .catch((error: unknown) => error);
    const second = controller
      .get(request(), checkoutId)
      .catch((error: unknown) => error);
    const [foreign, missing] = await Promise.all([first, second]);
    expect((foreign as BadRequestException).getStatus()).toBe(404);
    expect((foreign as BadRequestException).getResponse()).toEqual(
      (missing as BadRequestException).getResponse(),
    );
  });

  it('translates conflict and persistence errors without internal bodies', async () => {
    const { controller, update, getSummary } = fixture();
    update.mockImplementation(() =>
      errAsync({ kind: 'CHECKOUT_LOCKED' as const }),
    );
    getSummary.mockImplementation(() =>
      errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' as const }),
    );

    await expect(
      controller.patch(request(), checkoutId, { quantity: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    const error = await controller
      .getSummary(request(), checkoutId)
      .catch((value: unknown) => value);
    expect((error as BadRequestException).getStatus()).toBe(503);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).not.toMatch(/postgres|query|constraint|stack/i);
  });

  it('normalizes validation exceptions through the input filter', () => {
    const res = response();
    const host = {
      switchToHttp: () => ({ getResponse: () => res.value }),
    } as unknown as ArgumentsHost;
    new CheckoutInputFilter().catch(new BadRequestException('private'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.json.mock.calls[0][0])).toContain(
      'INVALID_REQUEST',
    );
  });
});
