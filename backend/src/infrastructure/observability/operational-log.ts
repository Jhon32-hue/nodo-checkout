import type { LoggerService } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type OperationalEvent =
  | 'transaction.created'
  | 'reservation.held'
  | 'payment.claimed'
  | 'provider.request.started'
  | 'provider.response.received'
  | 'provider.request.failed'
  | 'provider.transaction.saved'
  | 'payment.sync.started'
  | 'payment.finalized.approved'
  | 'payment.finalized.declined'
  | 'payment.finalized.error'
  | 'payment.unknown'
  | 'inventory.confirmed'
  | 'reservation.released'
  | 'delivery.created';

export interface OperationalFields {
  checkoutId?: string;
  transactionId?: string;
  reference?: string;
  providerEnvironment?: string;
  previousStatus?: string;
  newStatus?: string;
  previousDispatchStatus?: string;
  newDispatchStatus?: string;
  providerHttpStatus?: number;
  durationMs?: number;
  errorCode?: string;
  operation?: 'configuration' | 'creation' | 'query';
  providerTransactionFingerprint?: string;
}

const safeText = (value: unknown, max: number) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  /^[A-Za-z0-9_.:-]+$/.test(value)
    ? value
    : undefined;

export function providerFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function operationalLog(
  event: OperationalEvent,
  fields: OperationalFields = {},
) {
  // Runtime allowlist: never spread arbitrary inputs, provider payloads or errors.
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    ...(safeText(fields.checkoutId, 64)
      ? { checkoutId: fields.checkoutId }
      : {}),
    ...(safeText(fields.transactionId, 64)
      ? { transactionId: fields.transactionId }
      : {}),
    ...(safeText(fields.reference, 64) ? { reference: fields.reference } : {}),
    ...(safeText(fields.providerEnvironment, 32)
      ? { providerEnvironment: fields.providerEnvironment }
      : {}),
    ...(safeText(fields.previousStatus, 32)
      ? { previousStatus: fields.previousStatus }
      : {}),
    ...(safeText(fields.newStatus, 32) ? { newStatus: fields.newStatus } : {}),
    ...(safeText(fields.previousDispatchStatus, 32)
      ? { previousDispatchStatus: fields.previousDispatchStatus }
      : {}),
    ...(safeText(fields.newDispatchStatus, 32)
      ? { newDispatchStatus: fields.newDispatchStatus }
      : {}),
    ...(Number.isInteger(fields.providerHttpStatus) &&
    fields.providerHttpStatus! >= 100 &&
    fields.providerHttpStatus! <= 599
      ? { providerHttpStatus: fields.providerHttpStatus }
      : {}),
    ...(Number.isFinite(fields.durationMs) && fields.durationMs! >= 0
      ? { durationMs: Math.round(fields.durationMs!) }
      : {}),
    ...(safeText(fields.errorCode, 64) ? { errorCode: fields.errorCode } : {}),
    ...(fields.operation ? { operation: fields.operation } : {}),
    ...(safeText(fields.providerTransactionFingerprint, 64)
      ? {
          providerTransactionFingerprint: fields.providerTransactionFingerprint,
        }
      : {}),
  };
  return payload;
}

export function writeOperationalLog(
  logger: LoggerService,
  event: OperationalEvent,
  fields: OperationalFields = {},
) {
  logger.log(JSON.stringify(operationalLog(event, fields)));
}
