import { err, ok, Result } from 'neverthrow';

export const MAX_MONEY_CENTS = 2_000_000_000;
export type InvalidMoney = {
  kind: 'InvalidMoney';
  reason: 'InvalidAmount' | 'UnsupportedCurrency';
};

export class Money {
  private constructor(
    readonly cents: number,
    readonly currency: 'COP',
  ) {
    Object.freeze(this);
  }

  static fromCents(
    cents: unknown,
    currency: unknown,
  ): Result<Money, InvalidMoney> {
    if (
      typeof cents !== 'number' ||
      !Number.isSafeInteger(cents) ||
      cents < 0 ||
      cents > MAX_MONEY_CENTS
    ) {
      return err({ kind: 'InvalidMoney', reason: 'InvalidAmount' });
    }
    if (currency !== 'COP') {
      return err({ kind: 'InvalidMoney', reason: 'UnsupportedCurrency' });
    }
    return ok(new Money(cents, currency));
  }
}
