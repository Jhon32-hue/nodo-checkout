import { err, ok } from 'neverthrow';
import { calculateDraftSummary, validatePatch } from '../domain/checkout';
import {
  canonicalRequest,
  matchesSummary,
  canExpire,
} from '../domain/transaction';
import type { AcceptedSummary } from '../domain/transaction';
import type {
  TransactionStore,
  TransactionIdentity,
} from './transaction-ports';
export class CreateTransaction {
  constructor(
    private readonly store: TransactionStore,
    private readonly identity: TransactionIdentity,
    private readonly now: () => Date = () => new Date(),
  ) {}
  execute(
    sessionId: string,
    checkoutId: string,
    key: string,
    accepted: AcceptedSummary,
  ) {
    checkoutId = checkoutId.toLowerCase();
    key = key.toLowerCase();
    const hash = this.identity.hash(canonicalRequest(checkoutId, accepted));
    return this.store.run(sessionId, checkoutId, async (ctx) => {
      const replay = await ctx.replay(key);
      if (replay)
        return replay.hash === hash
          ? ok(replay.view)
          : err({ kind: 'IDEMPOTENCY_CONFLICT' });
      const checkout = ctx.checkout;
      if (checkout.status === 'PAID') return err({ kind: 'CHECKOUT_LOCKED' });
      const active = await ctx.lockActive();
      const product = await ctx.lockProduct();
      // Product lock precedes locking/releasing our reservation. Never touch another checkout.
      const now = this.now();
      if (active) {
        const reservation = await ctx.lockReservation(active.id);
        if (
          !canExpire(
            active.dispatchStatus,
            reservation.status,
            reservation.expiresAt,
            now,
          )
        )
          return err({ kind: 'CHECKOUT_LOCKED' });
        await ctx.expire(active, reservation, now);
        checkout.status = 'DRAFT';
      }
      if (checkout.status !== 'DRAFT') return err({ kind: 'CHECKOUT_LOCKED' });
      if (!checkout.buyer || !checkout.delivery)
        return err({ kind: 'INCOMPLETE_CHECKOUT' });
      const complete = validatePatch({
        quantity: checkout.quantity,
        buyer: checkout.buyer,
        delivery: checkout.delivery,
      });
      if (complete.isErr()) return err(complete.error);
      const { buyer, delivery } = complete.value;
      if (!buyer || !delivery) return err({ kind: 'INCOMPLETE_CHECKOUT' });
      if (!product.active) return err({ kind: 'PRODUCT_NOT_FOUND' });
      const summary = calculateDraftSummary(
        checkout.quantity,
        product.unitPriceCents,
        product.currency,
      );
      if (summary.isErr()) return err(summary.error);
      if (!matchesSummary(accepted, summary.value))
        return err({ kind: 'SUMMARY_CHANGED' });
      if ((await ctx.available(now)) < checkout.quantity)
        return err({ kind: 'INSUFFICIENT_STOCK' });
      return ok(
        await ctx.insert({
          product,
          buyer,
          delivery,
          summary: summary.value,
          key,
          hash,
          expiresAt: new Date(now.getTime() + 600000),
        }),
      );
    });
  }
}
export class GetTransaction {
  constructor(private readonly store: TransactionStore) {}
  execute(sessionId: string, id: string) {
    return this.store.get(sessionId, id, new Date());
  }
}
