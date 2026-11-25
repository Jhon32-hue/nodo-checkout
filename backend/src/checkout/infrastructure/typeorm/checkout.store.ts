import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { err, ok, ResultAsync } from 'neverthrow';
import type {
  CheckoutStore,
  SessionStore,
} from '../../application/checkout-ports';
import type {
  CheckoutError,
  CheckoutRecord,
  CheckoutView,
  Patch,
} from '../../domain/checkout';
import { CheckoutSessionOrmEntity } from './checkout-session.entity';
import { CheckoutOrmEntity } from './checkout.entity';
import { CustomerOrmEntity } from './customer.entity';
import { TransactionOrmEntity } from './transaction.entity';
import { DeliveryOrmEntity } from '../../../fulfillment/infrastructure/typeorm/delivery.entity';
import { ProductOrmEntity } from '../../../catalog/infrastructure/typeorm/product.entity';
const unavailable = (): CheckoutError => ({ kind: 'PERSISTENCE_UNAVAILABLE' });
@Injectable()
export class TypeOrmSessionStore implements SessionStore {
  constructor(private readonly db: DataSource) {}
  find(digest: string, now: Date) {
    return ResultAsync.fromPromise(
      this.db
        .getRepository(CheckoutSessionOrmEntity)
        .findOneBy({ tokenDigest: Buffer.from(digest, 'hex') }),
      unavailable,
    ).map((session) =>
      session && session.expiresAt > now
        ? { id: session.id, expiresAt: session.expiresAt }
        : null,
    );
  }
  create(digest: string, expiresAt: Date) {
    return ResultAsync.fromPromise(
      this.db.getRepository(CheckoutSessionOrmEntity).save({
        id: randomUUID(),
        tokenDigest: Buffer.from(digest, 'hex'),
        expiresAt,
      }),
      unavailable,
    ).map((s) => ({ id: s.id, expiresAt: s.expiresAt }));
  }
}
@Injectable()
export class TypeOrmCheckoutStore implements CheckoutStore {
  constructor(private readonly db: DataSource) {}
  create(sessionId: string, productId: string, quantity: number) {
    return ResultAsync.fromPromise(
      this.db.transaction(async (manager) => {
        const product = await manager.findOneBy(ProductOrmEntity, {
          id: productId,
          active: true,
        });
        if (!product)
          return err<CheckoutView, CheckoutError>({
            kind: 'PRODUCT_NOT_FOUND',
          });
        const checkout = await manager.save(CheckoutOrmEntity, {
          id: randomUUID(),
          sessionId,
          productId,
          quantity,
          status: 'DRAFT',
        });
        return ok((await this.read(manager, checkout)).view);
      }),
      unavailable,
    ).andThen((r) => r);
  }
  get(sessionId: string, id: string) {
    return ResultAsync.fromPromise(
      this.db.transaction(async (manager) => {
        const checkout = await manager.findOneBy(CheckoutOrmEntity, {
          id,
          sessionId,
        });
        return checkout
          ? ok(await this.read(manager, checkout))
          : err<CheckoutRecord, CheckoutError>({ kind: 'RESOURCE_NOT_FOUND' });
      }),
      unavailable,
    ).andThen((r) => r);
  }
  update(sessionId: string, id: string, patch: Patch) {
    return ResultAsync.fromPromise(
      this.db.transaction(async (manager) => {
        const checkout = await manager.findOne(CheckoutOrmEntity, {
          where: { id, sessionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!checkout)
          return err<CheckoutView, CheckoutError>({
            kind: 'RESOURCE_NOT_FOUND',
          });
        if (checkout.status !== 'DRAFT')
          return err<CheckoutView, CheckoutError>({ kind: 'CHECKOUT_LOCKED' });
        if (patch.buyer) {
          const customer = await manager.save(CustomerOrmEntity, {
            id: checkout.customerId ?? randomUUID(),
            ...patch.buyer,
          });
          checkout.customerId = customer.id;
        }
        if (patch.delivery) checkout.deliveryDraft = { ...patch.delivery };
        if (patch.quantity !== undefined) checkout.quantity = patch.quantity;
        await manager.save(checkout);
        return ok((await this.read(manager, checkout)).view);
      }),
      unavailable,
    ).andThen((r) => r);
  }
  private async read(
    manager: EntityManager,
    checkout: CheckoutOrmEntity,
  ): Promise<CheckoutRecord> {
    const product = await manager.findOneByOrFail(ProductOrmEntity, {
      id: checkout.productId,
    });
    const customer = checkout.customerId
      ? await manager.findOneByOrFail(CustomerOrmEntity, {
          id: checkout.customerId,
        })
      : null;
    const attempts = await manager.find(TransactionOrmEntity, {
      where: { checkoutId: checkout.id },
      order: { createdAt: 'DESC', attemptNumber: 'DESC' },
    });
    const active = attempts.find((t) => t.status === 'PENDING');
    const historical = attempts.find((t) => t.status === 'APPROVED') ?? active;
    const delivery = await manager.findOneBy(DeliveryOrmEntity, {
      checkoutId: checkout.id,
    });
    return {
      view: {
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
        activeTransactionId: active?.id ?? null,
        latestTransactionId: attempts[0]?.id ?? null,
        deliveryId: delivery?.id ?? null,
      },
      unitPriceCents: product.unitPriceCents,
      currency: product.currency,
      active: product.active,
      historical: historical
        ? {
            quantity: historical.quantity,
            unitPriceCents: historical.unitPriceCents,
            baseFeeCents: historical.baseFeeCents,
            deliveryFeeCents: historical.deliveryFeeCents,
            currency: historical.currency,
          }
        : null,
    };
  }
}
