import { err, ok, errAsync, okAsync } from 'neverthrow';
import type {
  CheckoutStore,
  SessionStore,
  SessionTokens,
} from './checkout-ports';
import {
  calculateSummary,
  calculateDraftSummary,
  validQuantity,
  validatePatch,
  CheckoutError,
} from '../domain/checkout';
export class EnsureCheckoutSession {
  constructor(
    private readonly store: SessionStore,
    private readonly tokens: SessionTokens,
    private readonly now: () => Date = () => new Date(),
  ) {}
  execute(token?: string) {
    return (
      token
        ? this.store.find(this.tokens.digest(token), this.now())
        : okAsync(null)
    ).andThen((session) => {
      if (session && token)
        return ok({
          session,
          token,
          created: false,
          csrfToken: this.tokens.csrf(token),
        });
      const fresh = this.tokens.generate();
      return this.store
        .create(
          this.tokens.digest(fresh),
          new Date(this.now().getTime() + 86400000),
        )
        .map((created) => ({
          session: created,
          token: fresh,
          created: true,
          csrfToken: this.tokens.csrf(fresh),
        }));
    });
  }
}
export class AuthenticateSession {
  constructor(
    private readonly store: SessionStore,
    private readonly tokens: SessionTokens,
  ) {}
  execute(token?: string) {
    if (!token) return errAsync({ kind: 'SESSION_REQUIRED' } as CheckoutError);
    return this.store
      .find(this.tokens.digest(token), new Date())
      .andThen((session) =>
        session
          ? ok(session)
          : err({ kind: 'SESSION_REQUIRED' } as CheckoutError),
      );
  }
}
export class CreateCheckout {
  constructor(private readonly store: CheckoutStore) {}
  execute(sessionId: string, productId: string, quantity: number) {
    if (!validQuantity(quantity))
      return errAsync({ kind: 'INVALID_QUANTITY' } as CheckoutError);
    return this.store.create(sessionId, productId, quantity);
  }
}
export class GetCheckout {
  constructor(private readonly store: CheckoutStore) {}
  execute(sessionId: string, id: string) {
    return this.store.get(sessionId, id).map((record) => record.view);
  }
}
export class UpdateCheckout {
  constructor(private readonly store: CheckoutStore) {}
  execute(sessionId: string, id: string, input: unknown) {
    return validatePatch(input).asyncAndThen((patch) =>
      this.store.update(sessionId, id, patch),
    );
  }
}
export class GetSummary {
  constructor(private readonly store: CheckoutStore) {}
  execute(sessionId: string, id: string) {
    return this.store.get(sessionId, id).andThen((record) => {
      if (record.historical) return calculateSummary(record.historical);
      if (!record.view.buyer || !record.view.delivery)
        return err({ kind: 'INCOMPLETE_CHECKOUT' } as CheckoutError);
      if (!record.active || record.view.status !== 'DRAFT')
        return err({ kind: 'CHECKOUT_LOCKED' } as CheckoutError);
      return calculateDraftSummary(
        record.view.quantity,
        record.unitPriceCents,
        record.currency,
      );
    });
  }
}
