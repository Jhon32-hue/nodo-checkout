import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { err, ok, errAsync, Result, ResultAsync } from 'neverthrow';
import type {
  PaymentGateway,
  GatewayCreate,
} from '../application/payment-ports';
import type {
  GatewayError,
  Observation,
  PublicPaymentConfig,
  PayInput,
  RemoteStatus,
} from '../domain/payment';
export interface WompiEnvironment {
  baseUrl?: string;
  publicKey?: string;
  privateKey?: string;
  integritySecret?: string;
}
export const UAT_ORIGIN = 'https://api-sandbox.co.uat.wompi.dev';
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v;
const opaqueId = (v: unknown): v is string =>
  text(v, 128) && v !== '.' && v !== '..' && /^[a-zA-Z0-9._:-]+$/.test(v);
type Operation = 'configuration' | 'creation' | 'query';
export interface PaymentDiagnostic {
  stage: Operation;
  code: string;
  httpStatus?: number;
  localId?: string;
  reference?: string;
  remoteId?: string;
}
const logger = new Logger('PaymentGateway');
const unavailable = (
  reason: 'configuration' | 'transport' | 'http' | 'json' | 'schema',
  operation: Operation = 'creation',
  httpStatus?: number,
): GatewayError => ({
  kind: 'GATEWAY_UNAVAILABLE',
  operation,
  reason,
  ...(httpStatus === undefined ? {} : { httpStatus }),
});
function data(body: unknown): Result<Record<string, unknown>, GatewayError> {
  if (body === undefined) return err(unavailable('schema'));
  if (body === null) return err(unavailable('schema'));
  if (!record(body)) return err(unavailable('schema'));
  if (!Object.hasOwn(body, 'data')) return err(unavailable('schema'));
  if (body.data === null) return err(unavailable('schema'));
  return record(body.data) ? ok(body.data) : err(unavailable('schema'));
}

function https(v: unknown): v is string {
  if (!text(v, 4096)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function decodeObservation(
  body: unknown,
): Result<Observation, GatewayError> {
  return data(body).andThen((d) => {
    if (
      !opaqueId(d.id) ||
      !text(d.reference, 64) ||
      !Number.isSafeInteger(d.amount_in_cents) ||
      typeof d.amount_in_cents !== 'number' ||
      d.amount_in_cents < 1 ||
      d.amount_in_cents > 2000000000 ||
      d.currency !== 'COP' ||
      !text(d.status, 16) ||
      !['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(d.status)
    )
      return err(unavailable('schema'));
    const status: RemoteStatus =
      d.status === 'APPROVED'
        ? 'APPROVED'
        : d.status === 'DECLINED'
          ? 'DECLINED'
          : d.status === 'VOIDED'
            ? 'VOIDED'
            : d.status === 'ERROR'
              ? 'ERROR'
              : 'PENDING';
    return ok<Observation, GatewayError>({
      id: d.id,
      reference: d.reference,
      amountCents: d.amount_in_cents,
      currency: 'COP',
      status,
      environment: 'UAT_SANDBOX',
    });
  });
}
interface Contract {
  token: string;
  link: string;
  type: string;
}
function contract(v: unknown, type: string): Result<Contract, GatewayError> {
  if (
    !record(v) ||
    !text(v.acceptance_token, 8192) ||
    !https(v.permalink) ||
    v.type !== type
  )
    return err(unavailable('schema'));
  return ok({ token: v.acceptance_token, link: v.permalink, type });
}
function fingerprint(token: string): { key: string; link: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)))
      return null;
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    if (
      !record(payload) ||
      !Number.isSafeInteger(payload.contract_id) ||
      !text(payload.file_hash, 256) ||
      !https(payload.permalink)
    )
      return null;
    if (
      Object.hasOwn(payload, 'exp') &&
      (typeof payload.exp !== 'number' ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp * 1000 <= Date.now())
    )
      return null;
    return {
      key: JSON.stringify([
        payload.contract_id,
        payload.file_hash,
        payload.permalink,
      ]),
      link: payload.permalink,
    };
  } catch {
    return null;
  }
}
export function integritySignature(
  reference: string,
  amount: number,
  currency: string,
  secret: string,
): string {
  return createHash('sha256')
    .update(reference + amount.toString() + currency + secret)
    .digest('hex');
}
export class WompiPaymentGateway implements PaymentGateway {
  private readonly base: string | null;
  constructor(
    private readonly env: WompiEnvironment,
    private readonly http: typeof fetch = fetch,
    private readonly timeoutMs = 8000,
    private readonly diagnostic: (event: PaymentDiagnostic) => void = (event) =>
      logger.log(JSON.stringify(event)),
  ) {
    const base = env.baseUrl?.replace(/\/$/, '').replace(/\/v1$/, '');
    this.base =
      base === UAT_ORIGIN &&
      /^pub_(?:test|stagtest)_/.test(env.publicKey ?? '') &&
      /^prv_(?:test|stagtest)_/.test(env.privateKey ?? '') &&
      Boolean(env.integritySecret?.trim())
        ? base
        : null;
  }
  private report(event: PaymentDiagnostic) {
    // Build an allowlist, never serialize an input, error, response or arbitrary properties.
    this.diagnostic({
      stage: event.stage,
      code: event.code,
      ...(event.httpStatus === undefined
        ? {}
        : { httpStatus: event.httpStatus }),
      ...(opaqueId(event.localId) ? { localId: event.localId } : {}),
      ...(text(event.reference, 64) && /^[a-zA-Z0-9_-]+$/.test(event.reference)
        ? { reference: event.reference }
        : {}),
      ...(opaqueId(event.remoteId) ? { remoteId: event.remoteId } : {}),
    });
  }
  private request<T>(
    operation: Operation,
    path: string,
    decode: (body: unknown) => Result<T, GatewayError>,
    method: 'GET' | 'POST',
    body?: unknown,
    publicHeader = false,
    context: { localId?: string; reference?: string; remoteId?: string } = {},
  ): ResultAsync<T, GatewayError> {
    const call = async (): Promise<Result<T, GatewayError>> => {
      if (!this.base) return err(unavailable('configuration', operation));
      let response: Response;
      try {
        response = await this.http(this.base + path, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: publicHeader
            ? { 'x-merchant-public-key': this.env.publicKey ?? '' }
            : {
                Authorization: 'Bearer ' + (this.env.privateKey ?? ''),
                'Content-Type': 'application/json',
              },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        return err(unavailable('transport', operation));
      }
      if (!response.ok)
        return err(unavailable('http', operation, response.status));
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        return err(unavailable('json', operation, response.status));
      }
      return decode(parsed)
        .mapErr(() => unavailable('schema', operation, response.status))
        .map((value) => {
          const remoteId =
            record(value) && opaqueId(value.id) ? value.id : context.remoteId;
          this.report({
            ...context,
            remoteId,
            stage: operation,
            code: 'VALIDATED',
            httpStatus: response.status,
          });
          return value;
        });
    };
    return ResultAsync.fromPromise(call(), () =>
      unavailable('transport', operation),
    )
      .andThen((result) => result)
      .mapErr((error) => {
        if (error.kind === 'GATEWAY_UNAVAILABLE')
          this.report({
            ...context,
            stage: operation,
            code: 'GATEWAY_' + error.reason.toUpperCase(),
            httpStatus: error.httpStatus,
          });
        return error;
      });
  }
  configuration() {
    return this.request(
      'configuration',
      '/v1/merchants/info',
      (body) =>
        data(body).andThen((d) =>
          contract(d.presigned_acceptance, 'END_USER_POLICY').andThen(
            (policy) =>
              contract(
                d.presigned_personal_data_auth,
                'PERSONAL_DATA_AUTH',
              ).andThen((personal) => {
                const current = fingerprint(policy.token),
                  auth = fingerprint(personal.token);
                if (
                  !current ||
                  !auth ||
                  current.link !== policy.link ||
                  auth.link !== personal.link ||
                  current.key === auth.key
                )
                  return err(unavailable('schema', 'configuration'));
                return ok<PublicPaymentConfig, GatewayError>({
                  environment: 'UAT_SANDBOX',
                  publicKey: this.env.publicKey ?? '',
                  tokenizationUrl: UAT_ORIGIN + '/v1/tokens/cards',
                  installments: 1,
                  acceptance: {
                    acceptanceToken: policy.token,
                    personalAuthToken: personal.token,
                    policyUrl: policy.link,
                    personalDataUrl: personal.link,
                  },
                });
              }),
          ),
        ),
      'GET',
      undefined,
      true,
    );
  }
  validateAcceptance(input: PayInput) {
    return this.configuration().andThen((config) =>
      fingerprint(config.acceptance.acceptanceToken)?.key ===
        fingerprint(input.acceptance.acceptanceToken)?.key &&
      fingerprint(config.acceptance.personalAuthToken)?.key ===
        fingerprint(input.acceptance.personalAuthToken)?.key
        ? ok(undefined)
        : err<undefined, GatewayError>({ kind: 'INVALID_ACCEPTANCE' }),
    );
  }
  create({ record: r, input: p }: GatewayCreate) {
    return this.request(
      'creation',
      '/v1/transactions',
      decodeObservation,
      'POST',
      {
        reference: r.reference,
        amount_in_cents: r.amountCents,
        currency: r.currency,
        customer_email: r.buyer.email,
        customer_data: {
          full_name: r.buyer.fullName,
          phone_number: r.buyer.phone,
        },
        payment_method_type: 'CARD',
        payment_method: { type: 'CARD', token: p.cardToken, installments: 1 },
        signature: integritySignature(
          r.reference,
          r.amountCents,
          r.currency,
          this.env.integritySecret ?? '',
        ),
        acceptance_token: p.acceptance.acceptanceToken,
        accept_personal_auth: p.acceptance.personalAuthToken,
      },
      false,
      { localId: r.view.id, reference: r.reference },
    );
  }
  get(id: string, context?: { localId: string; reference: string }) {
    if (!opaqueId(id))
      return errAsync<Observation, GatewayError>(
        unavailable('schema', 'query'),
      );
    return this.request(
      'query',
      '/v1/transactions/' + encodeURIComponent(id),
      decodeObservation,
      'GET',
      undefined,
      false,
      { ...context, remoteId: id },
    );
  }
}
