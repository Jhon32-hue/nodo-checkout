import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response } from 'express';
import type { SessionTokens, Session } from '../../application/checkout-ports';
import { AuthenticateSession } from '../../application/checkout-cases';
import type { CheckoutError } from '../../domain/checkout';
export function failure(error: CheckoutError): HttpException {
  const status =
    error.kind === 'SESSION_REQUIRED'
      ? 401
      : ['ORIGIN_DENIED', 'CSRF_INVALID'].includes(error.kind)
        ? 403
        : ['RESOURCE_NOT_FOUND', 'PRODUCT_NOT_FOUND'].includes(error.kind)
          ? 404
          : [
                'CHECKOUT_LOCKED',
                'IDEMPOTENCY_CONFLICT',
                'SUMMARY_CHANGED',
                'INSUFFICIENT_STOCK',
              ].includes(error.kind)
            ? 409
            : error.kind === 'PERSISTENCE_UNAVAILABLE'
              ? 503
              : 422;
  return new HttpException(
    {
      error: {
        code: error.kind,
        message:
          status === 503
            ? 'No fue posible completar la operación.'
            : error.kind,
      },
    },
    status,
  );
}
export interface CheckoutRequest extends Request {
  checkoutSession: Session;
  checkoutToken: string;
}
export const SessionBootstrap = () => SetMetadata('session-bootstrap', true);
export class CryptoSessionTokens implements SessionTokens {
  constructor(
    private readonly secret: string,
    readonly origins: readonly string[],
  ) {
    if (secret.length < 32)
      throw new Error('CSRF_SECRET must contain at least 32 characters');
    for (const origin of origins) {
      const url = new URL(origin);
      if (
        url.origin !== origin ||
        (url.protocol !== 'https:' &&
          (process.env.NODE_ENV === 'production' ||
            !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            url.protocol !== 'http:'))
      )
        throw new Error(
          'FRONTEND_ORIGINS must use HTTPS or local development HTTP',
        );
    }
  }
  generate() {
    return randomBytes(32).toString('hex');
  }
  digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  csrf(token: string) {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }
  verify(token: string, csrf: string) {
    return (
      /^[0-9a-f]{64}$/.test(csrf) &&
      timingSafeEqual(
        Buffer.from(this.csrf(token), 'hex'),
        Buffer.from(csrf, 'hex'),
      )
    );
  }
  cookie(request: Request) {
    const value = request.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('checkout_session='))
      ?.slice('checkout_session='.length);
    return value && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  }
}
@Injectable()
export class CheckoutGuard implements CanActivate {
  constructor(
    private readonly auth: AuthenticateSession,
    private readonly tokens: CryptoSessionTokens,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<CheckoutRequest>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    const bootstrap = this.reflector.get<boolean>(
      'session-bootstrap',
      context.getHandler(),
    );
    if (
      req.method !== 'GET' &&
      !this.tokens.origins.includes(req.headers.origin ?? '')
    )
      throw failure({ kind: 'ORIGIN_DENIED' });
    if (bootstrap) return true;
    const token = this.tokens.cookie(req);
    const session = await this.auth.execute(token);
    if (session.isErr()) throw failure(session.error);
    req.checkoutSession = session.value;
    req.checkoutToken = token ?? '';
    if (
      req.method !== 'GET' &&
      !this.tokens.verify(req.checkoutToken, req.get('X-CSRF-Token') ?? '')
    )
      throw failure({ kind: 'CSRF_INVALID' });
    return true;
  }
}
