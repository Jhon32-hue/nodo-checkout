import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { err, ok, ResultAsync } from 'neverthrow';
import type { Result } from 'neverthrow';
import type {
  PaymentStore,
  PaymentContext,
} from '../application/payment-ports';
import type { PaymentRecord, PaymentError } from '../domain/payment';
import { TransactionOrmEntity } from '../../checkout/infrastructure/typeorm/transaction.entity';
import { CheckoutOrmEntity } from '../../checkout/infrastructure/typeorm/checkout.entity';
import { ProductOrmEntity } from '../../catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../../catalog/infrastructure/typeorm/inventory-reservation.entity';
import { DeliveryOrmEntity } from '../../fulfillment/infrastructure/typeorm/delivery.entity';
import {
  calculateSummary,
  validatePatch,
} from '../../checkout/domain/checkout';
import {
  writeOperationalLog,
  providerFingerprint,
  type OperationalEvent,
  type OperationalFields,
} from '../../infrastructure/observability/operational-log';
const unavailable = (): PaymentError => ({ kind: 'PERSISTENCE_UNAVAILABLE' });
async function snapshot(
  manager: EntityManager,
  attempt: TransactionOrmEntity,
): Promise<PaymentRecord> {
  const reservation = await manager.findOneByOrFail(
    InventoryReservationOrmEntity,
    { transactionId: attempt.id },
  );
  const delivery = await manager.findOneBy(DeliveryOrmEntity, {
    transactionId: attempt.id,
  });
  const summary = calculateSummary({
    quantity: attempt.quantity,
    unitPriceCents: attempt.unitPriceCents,
    baseFeeCents: attempt.baseFeeCents,
    deliveryFeeCents: attempt.deliveryFeeCents,
    currency: attempt.currency,
  });
  const personal = validatePatch({
    buyer: attempt.buyerSnapshot,
    delivery: attempt.deliverySnapshot,
  });
  if (summary.isErr() || personal.isErr() || !personal.value.buyer)
    throw new Error('Invalid persisted payment snapshot');
  return {
    view: {
      id: attempt.id,
      checkoutId: attempt.checkoutId,
      status: attempt.status,
      dispatchStatus: attempt.dispatchStatus,
      reservationExpiresAt: reservation.expiresAt.toISOString(),
      deliveryId: delivery?.id ?? null,
    },
    reference: attempt.reference,
    amountCents: summary.value.totalCents,
    currency: attempt.currency,
    quantity: attempt.quantity,
    buyer: personal.value.buyer,
    environment: attempt.providerEnvironment,
    providerId: attempt.providerTransactionId,
    payHash: attempt.payRequestHash,
    startedAt: attempt.submissionStartedAt,
    reservationStatus: reservation.status,
    expiresAt: reservation.expiresAt,
  };
}
@Injectable()
export class TypeOrmPaymentStore implements PaymentStore {
  private readonly logger = new Logger(TypeOrmPaymentStore.name);

  constructor(private readonly db: DataSource) {}
  read(sessionId: string, id: string) {
    return ResultAsync.fromPromise(
      this.db.transaction('REPEATABLE READ', async (manager) => {
        const attempt = await manager
          .createQueryBuilder(TransactionOrmEntity, 't')
          .innerJoin('t.checkout', 'c')
          .where('t.id = :id AND c.session_id = :sessionId', { id, sessionId })
          .getOne();
        return attempt
          ? ok<PaymentRecord, PaymentError>(await snapshot(manager, attempt))
          : err<PaymentRecord, PaymentError>({ kind: 'RESOURCE_NOT_FOUND' });
      }),
      unavailable,
    )
      .map((result) => {
        if (result.isOk())
          writeOperationalLog(this.logger, 'payment.sync.started', {
            checkoutId: result.value.view.checkoutId,
            transactionId: result.value.view.id,
            reference: result.value.reference,
            providerEnvironment: result.value.environment,
            previousStatus: result.value.view.status,
            previousDispatchStatus: result.value.view.dispatchStatus,
          });
        return result;
      })
      .andThen((r) => r);
  }
  run<T>(
    sessionId: string,
    id: string,
    work: (ctx: PaymentContext) => Promise<Result<T, PaymentError>>,
  ) {
    const events: Array<{
      event: OperationalEvent;
      fields: OperationalFields;
    }> = [];
    return ResultAsync.fromPromise(
      this.db.transaction(async (manager) => {
        const own = await manager
          .createQueryBuilder(TransactionOrmEntity, 't')
          .innerJoin('t.checkout', 'c')
          .where('t.id = :id AND c.session_id = :sessionId', { id, sessionId })
          .getOne();
        if (!own) return err<T, PaymentError>({ kind: 'RESOURCE_NOT_FOUND' });
        const checkout = await manager.findOneOrFail(CheckoutOrmEntity, {
          where: { id: own.checkoutId, sessionId },
          lock: { mode: 'pessimistic_write' },
        });
        const attempt = await manager.findOneOrFail(TransactionOrmEntity, {
          where: { id, checkoutId: checkout.id },
          lock: { mode: 'pessimistic_write' },
        });
        const product = await manager.findOneOrFail(ProductOrmEntity, {
          where: { id: attempt.productId },
          lock: { mode: 'pessimistic_write' },
        });
        const reservation = await manager.findOneOrFail(
          InventoryReservationOrmEntity,
          { where: { transactionId: id }, lock: { mode: 'pessimistic_write' } },
        );
        const record = await snapshot(manager, attempt);
        const ctx: PaymentContext = {
          record,
          claim: async (hash, evidence, now) => {
            await manager.update(TransactionOrmEntity, id, {
              dispatchStatus: 'IN_FLIGHT',
              payRequestHash: hash,
              submissionStartedAt: now,
              acceptanceEvidence: { ...evidence },
            });
            events.push({
              event: 'payment.claimed',
              fields: {
                checkoutId: attempt.checkoutId,
                transactionId: attempt.id,
                reference: attempt.reference,
                providerEnvironment: attempt.providerEnvironment,
                previousStatus: attempt.status,
                newStatus: attempt.status,
                previousDispatchStatus: attempt.dispatchStatus,
                newDispatchStatus: 'IN_FLIGHT',
              },
            });
          },
          expire: async (now) => {
            await manager.update(TransactionOrmEntity, id, {
              status: 'EXPIRED',
              finalizedAt: now,
            });
            await manager.update(
              InventoryReservationOrmEntity,
              reservation.id,
              { status: 'RELEASED' },
            );
            await manager.update(CheckoutOrmEntity, checkout.id, {
              status: 'DRAFT',
            });
            events.push({
              event: 'reservation.released',
              fields: {
                checkoutId: attempt.checkoutId,
                transactionId: attempt.id,
                reference: attempt.reference,
                previousStatus: reservation.status,
                newStatus: 'RELEASED',
              },
            });
          },
          submitted: async (providerId) => {
            if (attempt.status === 'PENDING') {
              await manager.update(TransactionOrmEntity, id, {
                providerTransactionId: providerId,
                dispatchStatus: 'SUBMITTED',
              });
              events.push({
                event: 'provider.transaction.saved',
                fields: {
                  checkoutId: attempt.checkoutId,
                  transactionId: attempt.id,
                  reference: attempt.reference,
                  providerEnvironment: attempt.providerEnvironment,
                  previousDispatchStatus: attempt.dispatchStatus,
                  newDispatchStatus: 'SUBMITTED',
                  providerTransactionFingerprint:
                    providerFingerprint(providerId),
                },
              });
            }
          },
          unknown: async (reason) => {
            if (
              attempt.status === 'PENDING' &&
              attempt.dispatchStatus === 'IN_FLIGHT' &&
              !attempt.providerTransactionId
            )
              await manager.update(TransactionOrmEntity, id, {
                dispatchStatus: 'UNKNOWN',
                lastErrorCode: reason ?? 'STALE_IN_FLIGHT',
              });
            if (
              attempt.status === 'PENDING' &&
              attempt.dispatchStatus === 'IN_FLIGHT' &&
              !attempt.providerTransactionId
            )
              events.push({
                event: 'payment.unknown',
                fields: {
                  checkoutId: attempt.checkoutId,
                  transactionId: attempt.id,
                  reference: attempt.reference,
                  providerEnvironment: attempt.providerEnvironment,
                  previousStatus: attempt.status,
                  newStatus: attempt.status,
                  previousDispatchStatus: attempt.dispatchStatus,
                  newDispatchStatus: 'UNKNOWN',
                  errorCode: reason ?? 'STALE_IN_FLIGHT',
                },
              });
          },
          observe: async (o, now) => {
            if (o.status === 'PENDING') {
              await manager.update(TransactionOrmEntity, id, {
                dispatchStatus: 'SUBMITTED',
                providerTransactionId: o.id,
              });
              return;
            }
            if (reservation.status !== 'HELD')
              throw new Error('Invalid persisted reservation');
            if (o.status === 'APPROVED') {
              if (product.stock < attempt.quantity)
                throw new Error('Invalid persisted stock');
              await manager.update(ProductOrmEntity, product.id, {
                stock: product.stock - attempt.quantity,
              });
              await manager.update(
                InventoryReservationOrmEntity,
                reservation.id,
                { status: 'CONFIRMED' },
              );
              await manager.save(DeliveryOrmEntity, {
                id: randomUUID(),
                checkoutId: checkout.id,
                transactionId: id,
                status: 'READY',
              });
              await manager.update(CheckoutOrmEntity, checkout.id, {
                status: 'PAID',
              });
              events.push(
                {
                  event: 'inventory.confirmed',
                  fields: {
                    checkoutId: attempt.checkoutId,
                    transactionId: attempt.id,
                    reference: attempt.reference,
                    previousStatus: reservation.status,
                    newStatus: 'CONFIRMED',
                  },
                },
                {
                  event: 'delivery.created',
                  fields: {
                    checkoutId: attempt.checkoutId,
                    transactionId: attempt.id,
                    reference: attempt.reference,
                    newStatus: 'READY',
                  },
                },
              );
            } else {
              await manager.update(
                InventoryReservationOrmEntity,
                reservation.id,
                { status: 'RELEASED' },
              );
              await manager.update(CheckoutOrmEntity, checkout.id, {
                status: 'DRAFT',
              });
              events.push({
                event: 'reservation.released',
                fields: {
                  checkoutId: attempt.checkoutId,
                  transactionId: attempt.id,
                  reference: attempt.reference,
                  previousStatus: reservation.status,
                  newStatus: 'RELEASED',
                },
              });
            }
            await manager.update(TransactionOrmEntity, id, {
              status: o.status,
              dispatchStatus: 'SUBMITTED',
              providerTransactionId: o.id,
              finalizedAt: now,
            });
            events.push({
              event:
                o.status === 'APPROVED'
                  ? 'payment.finalized.approved'
                  : o.status === 'ERROR'
                    ? 'payment.finalized.error'
                    : 'payment.finalized.declined',
              fields: {
                checkoutId: attempt.checkoutId,
                transactionId: attempt.id,
                reference: attempt.reference,
                providerEnvironment: o.environment,
                previousStatus: attempt.status,
                newStatus: o.status,
                previousDispatchStatus: attempt.dispatchStatus,
                newDispatchStatus: 'SUBMITTED',
                providerTransactionFingerprint: providerFingerprint(o.id),
              },
            });
          },
          view: async () => {
            const fresh = await manager.findOneByOrFail(TransactionOrmEntity, {
              id,
            });
            return (await snapshot(manager, fresh)).view;
          },
        };
        return work(ctx);
      }),
      unavailable,
    )
      .map((result) => {
        // Flush only after the database transaction has committed.
        for (const item of events)
          writeOperationalLog(this.logger, item.event, item.fields);
        return result;
      })
      .andThen((r) => r);
  }
}
