import { MAX_MONEY_CENTS, Money } from './money';

describe('Money', () => {
  it.each([0, 1, 250000, MAX_MONEY_CENTS])(
    'preserves integer cents %p in COP',
    (cents) => {
      const result = Money.fromCents(cents, 'COP');
      expect(result.isOk()).toBe(true);
      if (result.isOk())
        expect(result.value).toMatchObject({ cents, currency: 'COP' });
    },
  );

  it.each([
    -1,
    0.5,
    250000.01,
    MAX_MONEY_CENTS + 1,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    -Infinity,
    '250000',
    null,
    undefined,
    true,
    1n,
  ])('rejects invalid amount %p without coercion', (cents) => {
    const result = Money.fromCents(cents, 'COP');
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error).toEqual({
        kind: 'InvalidMoney',
        reason: 'InvalidAmount',
      });
  });

  it.each(['USD', 'cop', '', null, undefined])(
    'rejects unsupported currency %p',
    (currency) => {
      const result = Money.fromCents(250000, currency);
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(result.error.reason).toBe('UnsupportedCurrency');
    },
  );
});
