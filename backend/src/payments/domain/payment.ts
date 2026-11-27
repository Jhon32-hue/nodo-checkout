import { err, ok, Result } from 'neverthrow';
import type { CheckoutError, Buyer } from '../../checkout/domain/checkout';
import type { AttemptView } from '../../checkout/domain/transaction';
export interface PayInput {
  cardToken: string;
  installments: number;
  acceptance: {
    acceptanceToken: string;
    personalAuthToken: string;
    policyAccepted: boolean;
    personalDataAccepted: boolean;
  };
}
export interface PublicPaymentConfig {
  environment: 'UAT_SANDBOX';
  publicKey: string;
  tokenizationPublicKey: string;
  tokenizationUrl: string;
  installments: 1;
  acceptance: {
    acceptanceToken: string;
    personalAuthToken: string;
    policyUrl: string;
    personalDataUrl: string;
  };
}
export type GatewayError =
  | {
      kind: 'GATEWAY_UNAVAILABLE';
      operation: 'configuration' | 'creation' | 'query';
      reason: 'configuration' | 'transport' | 'http' | 'json' | 'schema';
      httpStatus?: number;
    }
  | { kind: 'INVALID_ACCEPTANCE' };
export type PaymentError = CheckoutError | GatewayError;
export type RemoteStatus =
  'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
export interface Observation {
  id: string;
  reference: string;
  amountCents: number;
  currency: 'COP';
  status: RemoteStatus;
  environment: 'UAT_SANDBOX';
}
export interface PaymentRecord {
  view: AttemptView;
  reference: string;
  amountCents: number;
  currency: string;
  quantity: number;
  buyer: Buyer;
  environment: string;
  providerId: string | null;
  payHash: string | null;
  startedAt: Date | null;
  reservationStatus: string;
  expiresAt: Date;
}
export interface AcceptanceEvidence {
  policyAccepted: true;
  personalDataAccepted: true;
  acceptanceTokenHash: string;
  personalAuthTokenHash: string;
}
export function validPay(input: PayInput): Result<void, CheckoutError> {
  const opaque = (s: unknown, max: number) =>
    typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  return opaque(input.cardToken, 1024) &&
    input.installments === 1 &&
    input.acceptance?.policyAccepted === true &&
    input.acceptance?.personalDataAccepted === true &&
    opaque(input.acceptance.acceptanceToken, 8192) &&
    opaque(input.acceptance.personalAuthToken, 8192)
    ? ok(undefined)
    : err({ kind: 'INVALID_PAYMENT_INPUT' });
}
export function canonicalPay(p: PayInput): string {
  return JSON.stringify([
    p.cardToken,
    p.installments,
    p.acceptance.acceptanceToken,
    p.acceptance.personalAuthToken,
    p.acceptance.policyAccepted,
    p.acceptance.personalDataAccepted,
  ]);
}
export function checkPay(
  record: PaymentRecord,
  hash: string,
  now: Date,
): Result<'replay' | 'expired' | 'ready', CheckoutError> {
  if (record.payHash !== null)
    return record.payHash === hash
      ? ok('replay')
      : err({ kind: 'PAYLOAD_CONFLICT' });
  if (record.view.status === 'EXPIRED')
    return err({ kind: 'RESERVATION_EXPIRED' });
  if (
    record.view.status !== 'PENDING' ||
    record.view.dispatchStatus !== 'NOT_SENT' ||
    record.reservationStatus !== 'HELD'
  )
    return err({ kind: 'CHECKOUT_LOCKED' });
  return ok(record.expiresAt <= now ? 'expired' : 'ready');
}
export function matchesObservation(r: PaymentRecord, o: Observation): boolean {
  return (
    o.environment === r.environment &&
    o.reference === r.reference &&
    o.amountCents === r.amountCents &&
    o.currency === r.currency &&
    (r.providerId === null || r.providerId === o.id)
  );
}
