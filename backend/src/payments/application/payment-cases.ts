import { err, ok, errAsync } from 'neverthrow';
import {
  validPay,
  canonicalPay,
  checkPay,
  matchesObservation,
} from '../domain/payment';
import type { PayInput, PaymentError, Observation } from '../domain/payment';
import type {
  PaymentGateway,
  PaymentStore,
  PaymentHash,
} from './payment-ports';
export class GetPaymentConfig {
  constructor(private readonly gateway: PaymentGateway) {}
  execute() {
    return this.gateway.configuration();
  }
}
export class FinalizePayment {
  constructor(private readonly store: PaymentStore) {}
  execute(session: string, id: string, observation: Observation) {
    return this.store.run(session, id, async (ctx) => {
      const r = ctx.record;
      if (!matchesObservation(r, observation))
        return err({ kind: 'OBSERVATION_CONFLICT' });
      if (r.view.dispatchStatus === 'NOT_SENT')
        return err({ kind: 'OBSERVATION_CONFLICT' });
      if (r.view.status !== 'PENDING') {
        if (
          r.view.status !== observation.status &&
          observation.status !== 'PENDING'
        )
          return err({ kind: 'OBSERVATION_CONFLICT' });
        return ok(await ctx.view());
      }
      await ctx.observe(observation, new Date());
      return ok(await ctx.view());
    });
  }
}
export class StartPayment {
  constructor(
    private readonly store: PaymentStore,
    private readonly gateway: PaymentGateway,
    private readonly digest: PaymentHash,
    private readonly finalize: FinalizePayment,
  ) {}
  execute(session: string, id: string, input: PayInput) {
    const valid = validPay(input);
    if (valid.isErr()) return errAsync<never, PaymentError>(valid.error);
    const hash = this.digest.hash(canonicalPay(input));
    const prepare = (claim: boolean) =>
      this.store.run(session, id, async (ctx) => {
        const check = checkPay(ctx.record, hash, new Date());
        if (check.isErr()) return err(check.error);
        if (check.value === 'expired') {
          await ctx.expire(new Date());
          return err({ kind: 'RESERVATION_EXPIRED' });
        }
        if (check.value === 'replay')
          return ok({
            send: false,
            record: ctx.record,
            view: await ctx.view(),
          });
        if (claim)
          await ctx.claim(
            hash,
            {
              policyAccepted: true,
              personalDataAccepted: true,
              acceptanceTokenHash: this.digest.hash(
                input.acceptance.acceptanceToken,
              ),
              personalAuthTokenHash: this.digest.hash(
                input.acceptance.personalAuthToken,
              ),
            },
            new Date(),
          );
        return ok({ send: true, record: ctx.record, view: await ctx.view() });
      });
    return prepare(false).andThen((prepared) => {
      if (!prepared.send) return ok(prepared.view);
      return this.gateway
        .validateAcceptance(input)
        .andThen(() => prepare(true))
        .andThen((claimed) => {
          if (!claimed.send) return ok(claimed.view);
          // The durable IN_FLIGHT claim is already committed. No SQL transaction spans HTTP.
          return this.gateway
            .create({ record: claimed.record, input })
            .andThen((observation) =>
              this.store
                .run(session, id, async (ctx) => {
                  if (!matchesObservation(ctx.record, observation))
                    return err({ kind: 'OBSERVATION_CONFLICT' });
                  await ctx.submitted(observation.id);
                  return ok(observation);
                })
                .andThen((saved) => this.finalize.execute(session, id, saved)),
            )
            .orElse((error) =>
              error.kind === 'GATEWAY_UNAVAILABLE'
                ? this.store.run(session, id, async (ctx) => {
                    await ctx.unknown('GATEWAY_' + error.reason.toUpperCase());
                    return ok(await ctx.view());
                  })
                : errAsync(error),
            );
        });
    });
  }
}
export class SyncPayment {
  constructor(
    private readonly store: PaymentStore,
    private readonly gateway: PaymentGateway,
    private readonly finalize: FinalizePayment,
  ) {}
  execute(session: string, id: string) {
    return this.store.read(session, id).andThen((record) => {
      if (record.providerId)
        return this.gateway
          .get(record.providerId, {
            localId: record.view.id,
            reference: record.reference,
          })
          .andThen((o) => this.finalize.execute(session, id, o));
      return this.store.run(session, id, async (ctx) => {
        const r = ctx.record;
        if (
          r.view.dispatchStatus === 'IN_FLIGHT' &&
          r.startedAt &&
          Date.now() - r.startedAt.getTime() > 30000
        )
          await ctx.unknown();
        return ok(await ctx.view());
      });
    });
  }
}
