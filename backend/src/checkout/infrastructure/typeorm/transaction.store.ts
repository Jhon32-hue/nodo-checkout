import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { err, ok, ResultAsync } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { CheckoutError } from '../../domain/checkout';
import { calculateSummary } from '../../domain/checkout';
import type { AttemptView, AttemptDetails } from '../../domain/transaction';
import type {
  TransactionStore,
  AttemptContext,
  AttemptWrite,
} from '../../application/transaction-ports';
import { CheckoutOrmEntity } from './checkout.entity';
import { TransactionOrmEntity } from './transaction.entity';
import { CustomerOrmEntity } from './customer.entity';
import { ProductOrmEntity } from '../../../catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../../../catalog/infrastructure/typeorm/inventory-reservation.entity';
import { DeliveryOrmEntity } from '../../../fulfillment/infrastructure/typeorm/delivery.entity';
const unavailable = (): CheckoutError => ({ kind: 'PERSISTENCE_UNAVAILABLE' });
async function view(
  manager: EntityManager,
  attempt: TransactionOrmEntity,
): Promise<AttemptView> {
  const reservation = await manager.findOneByOrFail(
    InventoryReservationOrmEntity,
    { transactionId: attempt.id },
  );
  const delivery = await manager.findOneBy(DeliveryOrmEntity, {
    transactionId: attempt.id,
  });
  return {
    id: attempt.id,
    checkoutId: attempt.checkoutId,
    status: attempt.status,
    dispatchStatus: attempt.dispatchStatus,
    reservationExpiresAt: reservation.expiresAt.toISOString(),
    deliveryId: delivery?.id ?? null,
  };
}
@Injectable()
export class TypeOrmTransactionStore implements TransactionStore {
  constructor(private readonly db: DataSource) {}
  run(
    sessionId: string,
    checkoutId: string,
    work: (ctx: AttemptContext) => Promise<Result<AttemptView, CheckoutError>>,
  ) {
    return ResultAsync.fromPromise(
      this.db.transaction(async (manager) => {
        const checkout = await manager.findOne(CheckoutOrmEntity, {
          where: { id: checkoutId, sessionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!checkout)
          return err<AttemptView, CheckoutError>({
            kind: 'RESOURCE_NOT_FOUND',
          });
        const customer = checkout.customerId
          ? await manager.findOneByOrFail(CustomerOrmEntity, {
              id: checkout.customerId,
            })
          : null;
        const context: AttemptContext = {
          checkout: {
            id: checkout.id,
            productId: checkout.productId,
            quantity: checkout.quantity,
            status: checkout.status,
            buyer: customer
              ? {
                  fullName: customer.fullName,
                  email: customer.email,
                  phone: customer.phone,
                }
              : null,
            delivery: checkout.deliveryDraft,
          },
          replay: async (key) => {
            const attempt = await manager.findOneBy(TransactionOrmEntity, {
              checkoutId,
              idempotencyKey: key,
            });
            return attempt
              ? {
                  hash: attempt.createRequestHash,
                  view: await view(manager, attempt),
                }
              : null;
          },
          lockActive: () =>
            manager.findOne(TransactionOrmEntity, {
              where: { checkoutId, status: 'PENDING' },
              lock: { mode: 'pessimistic_write' },
            }),
          lockProduct: () =>
            manager.findOneOrFail(ProductOrmEntity, {
              where: { id: checkout.productId },
              lock: { mode: 'pessimistic_write' },
            }),
          lockReservation: (id) =>
            manager.findOneOrFail(InventoryReservationOrmEntity, {
              where: { transactionId: id },
              lock: { mode: 'pessimistic_write' },
            }),
          expire: async (attempt, reservation, now) => {
            await manager.update(TransactionOrmEntity, attempt.id, {
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
          },
          available: async (now) => {
            const held = await manager
              .createQueryBuilder(InventoryReservationOrmEntity, 'r')
              .innerJoin('r.transaction', 't')
              .select('COALESCE(SUM(r.quantity),0)', 'held')
              .where('r.product_id = :id', { id: checkout.productId })
              .andWhere("r.status = 'HELD'")
              .andWhere(
                "(t.dispatch_status <> 'NOT_SENT' OR r.expires_at > :now)",
                { now },
              )
              .getRawOne<{ held: string }>();
            const product = await manager.findOneByOrFail(ProductOrmEntity, {
              id: checkout.productId,
            });
            return product.stock - Number(held?.held ?? 0);
          },
          insert: async (input: AttemptWrite) => {
            const latest = await manager.findOne(TransactionOrmEntity, {
              where: { checkoutId },
              order: { attemptNumber: 'DESC' },
            });
            const attempt = await manager.save(TransactionOrmEntity, {
              id: randomUUID(),
              checkoutId,
              productId: checkout.productId,
              attemptNumber: (latest?.attemptNumber ?? 0) + 1,
              reference: 'pc_' + randomUUID().replaceAll('-', ''),
              idempotencyKey: input.key,
              createRequestHash: input.hash,
              status: 'PENDING',
              dispatchStatus: 'NOT_SENT',
              productName: input.product.name,
              productDescription: input.product.description,
              quantity: input.summary.quantity,
              unitPriceCents: input.summary.unitPriceCents,
              baseFeeCents: input.summary.baseFeeCents,
              deliveryFeeCents: input.summary.deliveryFeeCents,
              currency: input.summary.currency,
              buyerSnapshot: { ...input.buyer },
              deliverySnapshot: { ...input.delivery },
            });
            await manager.save(InventoryReservationOrmEntity, {
              id: randomUUID(),
              transactionId: attempt.id,
              productId: checkout.productId,
              quantity: attempt.quantity,
              status: 'HELD',
              expiresAt: input.expiresAt,
            });
            await manager.update(CheckoutOrmEntity, checkout.id, {
              status: 'PAYMENT_PENDING',
            });
            return view(manager, attempt);
          },
        };
        // Business errors commit deliberate expiration; SQL exceptions roll back every partial write.
        return work(context);
      }),
      unavailable,
    ).andThen((result) => result);
  }
  get(sessionId: string, id: string, now: Date) {
    return ResultAsync.fromPromise(
      this.db.transaction('REPEATABLE READ', async (manager) => {
        const attempt = await manager
          .createQueryBuilder(TransactionOrmEntity, 't')
          .innerJoin('t.checkout', 'c')
          .where('t.id = :id AND c.session_id = :sessionId', { id, sessionId })
          .getOne();
        if (!attempt)
          return err<AttemptDetails, CheckoutError>({
            kind: 'RESOURCE_NOT_FOUND',
          });
        const reservation = await manager.findOneByOrFail(
          InventoryReservationOrmEntity,
          { transactionId: id },
        );
        const summary = calculateSummary({
          quantity: attempt.quantity,
          unitPriceCents: attempt.unitPriceCents,
          baseFeeCents: attempt.baseFeeCents,
          deliveryFeeCents: attempt.deliveryFeeCents,
          currency: attempt.currency,
        });
        if (summary.isErr())
          return err<AttemptDetails, CheckoutError>(unavailable());
        return ok<AttemptDetails, CheckoutError>({
          ...(await view(manager, attempt)),
          reference: attempt.reference,
          summary: summary.value,
          createdAt: attempt.createdAt.toISOString(),
          finalizedAt: attempt.finalizedAt?.toISOString() ?? null,
          reservationStatus: reservation.status,
          reservationExpired:
            attempt.dispatchStatus === 'NOT_SENT' &&
            reservation.expiresAt <= now,
        });
      }),
      unavailable,
    ).andThen((result) => result);
  }
}
