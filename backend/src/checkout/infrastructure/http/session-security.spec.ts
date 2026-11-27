import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { errAsync, okAsync } from 'neverthrow';
import { AuthenticateSession } from '../../application/checkout-cases';
import type { Session } from '../../application/checkout-ports';
import {
  CheckoutGuard,
  CryptoSessionTokens,
  failure,
} from './session-security';
import type { CheckoutRequest } from './session-security';

const secret = 'a-secure-test-secret-with-32-characters';
const origin = 'https://store.example.test';
const validToken = 'a'.repeat(64);
const session: Session = {
  id: 'session-test',
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
};

function request(
  method = 'GET',
  headers: Record<string, string | undefined> = {},
): CheckoutRequest {
  return {
    method,
    headers,
    get: jest.fn((name: string) => headers[name.toLowerCase()]),
  } as unknown as CheckoutRequest;
}

function response() {
  const setHeader = jest.fn<unknown, [string, string]>();
  return {
    value: { setHeader } as unknown as Response,
    setHeader,
  };
}

function context(req: CheckoutRequest, res: Response): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => undefined,
    }),
    getHandler: () => function handler() {},
  } as unknown as ExecutionContext;
}

describe('guest session security', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('requires a strong secret and HTTPS except for local development', () => {
    expect(() => new CryptoSessionTokens('short', [origin])).toThrow(
      'CSRF_SECRET',
    );
    expect(
      () => new CryptoSessionTokens(secret, ['http://example.test']),
    ).toThrow('FRONTEND_ORIGINS');
    expect(() => new CryptoSessionTokens(secret, [`${origin}/path`])).toThrow(
      'FRONTEND_ORIGINS',
    );
    expect(
      () =>
        new CryptoSessionTokens(secret, [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://[::1]:5173',
        ]),
    ).not.toThrow();

    process.env.NODE_ENV = 'production';
    expect(
      () => new CryptoSessionTokens(secret, ['http://localhost:5173']),
    ).toThrow('FRONTEND_ORIGINS');
  });

  it('generates opaque tokens and verifies only a matching CSRF signature', () => {
    const tokens = new CryptoSessionTokens(secret, [origin]);
    const token = tokens.generate();
    const csrf = tokens.csrf(token);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.digest(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(csrf).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.verify(token, csrf)).toBe(true);
    expect(tokens.verify(`${token}x`, csrf)).toBe(false);
    expect(tokens.verify(token, 'not-a-signature')).toBe(false);
  });

  it('reads only a well-formed checkout cookie', () => {
    const tokens = new CryptoSessionTokens(secret, [origin]);
    expect(
      tokens.cookie(
        request('GET', {
          cookie: `other=value; checkout_session=${validToken}; last=value`,
        }) as unknown as Request,
      ),
    ).toBe(validToken);
    expect(
      tokens.cookie(request('GET', { cookie: 'checkout_session=altered' })),
    ).toBeUndefined();
    expect(tokens.cookie(request())).toBeUndefined();
  });

  it('allows bootstrap without authentication but still checks write origin', async () => {
    const tokens = new CryptoSessionTokens(secret, [origin]);
    const execute = jest.fn(() => okAsync(session));
    const reflector = {
      get: jest.fn(() => true),
    } as unknown as Reflector;
    const guard = new CheckoutGuard(
      { execute } as unknown as AuthenticateSession,
      tokens,
      reflector,
    );
    const res = response();

    await expect(
      guard.canActivate(context(request('GET'), res.value)),
    ).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');

    await expect(
      guard.canActivate(context(request('POST'), response().value)),
    ).rejects.toMatchObject({ status: 403 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates an authenticated session and enforces CSRF on writes', async () => {
    const tokens = new CryptoSessionTokens(secret, [origin]);
    const execute = jest.fn(() => okAsync(session));
    const guard = new CheckoutGuard(
      { execute } as unknown as AuthenticateSession,
      tokens,
      { get: jest.fn(() => false) } as unknown as Reflector,
    );
    const csrf = tokens.csrf(validToken);
    const req = request('POST', {
      cookie: `checkout_session=${validToken}`,
      origin,
      'x-csrf-token': csrf,
    });

    await expect(
      guard.canActivate(context(req, response().value)),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(validToken);
    expect(req.checkoutSession).toEqual(session);
    expect(req.checkoutToken).toBe(validToken);

    const invalidCsrf = request('PATCH', {
      cookie: `checkout_session=${validToken}`,
      origin,
      'x-csrf-token': 'invalid',
    });
    await expect(
      guard.canActivate(context(invalidCsrf, response().value)),
    ).rejects.toMatchObject({ status: 403 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('propagates authentication rejection for absent, malformed and well-formed cookies', async () => {
    const tokens = new CryptoSessionTokens(secret, [origin]);
    const execute = jest.fn(() =>
      errAsync({ kind: 'SESSION_REQUIRED' as const }),
    );
    const guard = new CheckoutGuard(
      { execute } as unknown as AuthenticateSession,
      tokens,
      { get: jest.fn(() => false) } as unknown as Reflector,
    );

    for (const req of [
      request(),
      request('GET', { cookie: 'checkout_session=altered' }),
      request('GET', { cookie: `checkout_session=${validToken}` }),
    ]) {
      await expect(
        guard.canActivate(context(req, response().value)),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(execute).toHaveBeenNthCalledWith(1, undefined);
    expect(execute).toHaveBeenNthCalledWith(2, undefined);
    expect(execute).toHaveBeenNthCalledWith(3, validToken);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('maps all public error families without leaking internal details', () => {
    const cases = [
      ['ORIGIN_DENIED', 403],
      ['PRODUCT_NOT_FOUND', 404],
      ['RESERVATION_EXPIRED', 409],
      ['OBSERVATION_CONFLICT', 409],
      ['PAYLOAD_CONFLICT', 409],
      ['INVALID_BUYER', 422],
    ] as const;
    for (const [kind, expectedStatus] of cases) {
      const error: HttpException = failure({ kind });
      expect(error.getStatus()).toBe(expectedStatus);
      expect(JSON.stringify(error.getResponse())).not.toMatch(
        /password|constraint|stack|query/i,
      );
    }
  });
});
