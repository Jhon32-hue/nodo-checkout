import { err, ok, Result } from 'neverthrow';
import { Money } from '../../shared/domain/money';
export type CheckoutCode =
  | 'IDEMPOTENCY_CONFLICT'
  | 'SUMMARY_CHANGED'
  | 'INSUFFICIENT_STOCK'
  | 'SESSION_REQUIRED'
  | 'ORIGIN_DENIED'
  | 'CSRF_INVALID'
  | 'RESOURCE_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'CHECKOUT_LOCKED'
  | 'INVALID_BUYER'
  | 'INVALID_DELIVERY'
  | 'INVALID_QUANTITY'
  | 'INVALID_AMOUNT'
  | 'INCOMPLETE_CHECKOUT'
  | 'PERSISTENCE_UNAVAILABLE';
export type CheckoutError = { kind: CheckoutCode };
export interface Buyer {
  fullName: string;
  email: string;
  phone: string;
}
export interface Delivery {
  recipientName: string;
  phone: string;
  addressLine1: string;
  city: string;
  region: string;
  country: string;
  addressLine2?: string | null;
  postalCode?: string | null;
}
export interface Patch {
  quantity?: number;
  buyer?: Buyer;
  delivery?: Delivery;
}
export interface Summary {
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  baseFeeCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  currency: string;
}
export interface CheckoutView {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  buyer: Buyer | null;
  delivery: Record<string, unknown> | null;
  activeTransactionId: string | null;
  latestTransactionId: string | null;
  deliveryId: string | null;
}
export interface CheckoutRecord {
  view: CheckoutView;
  unitPriceCents: number;
  currency: string;
  active: boolean;
  historical: Omit<Summary, 'subtotalCents' | 'totalCents'> | null;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function validQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 99
  );
}
function text(
  r: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): string | null {
  const v = r[key];
  return typeof v === 'string' &&
    v.trim().length >= min &&
    v.trim().length <= max
    ? v.trim()
    : null;
}
export function validatePatch(input: unknown): Result<Patch, CheckoutError> {
  if (
    !record(input) ||
    Object.values(input).every((value) => value === undefined) ||
    Object.keys(input).some(
      (k) => !['quantity', 'buyer', 'delivery'].includes(k),
    )
  )
    return err({ kind: 'INVALID_DELIVERY' });
  const patch: Patch = {};
  if (input.quantity !== undefined) {
    if (!validQuantity(input.quantity))
      return err({ kind: 'INVALID_QUANTITY' });
    patch.quantity = input.quantity;
  }
  if (input.buyer !== undefined) {
    const b = input.buyer;
    if (
      !record(b) ||
      Object.keys(b).some((k) => !['fullName', 'email', 'phone'].includes(k))
    )
      return err({ kind: 'INVALID_BUYER' });
    const fullName = text(b, 'fullName', 2, 120),
      email = text(b, 'email', 3, 254),
      phone = text(b, 'phone', 2, 16);
    if (
      !fullName ||
      !email ||
      !phone ||
      !/^\S+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\+[1-9]\d{1,14}$/.test(phone)
    )
      return err({ kind: 'INVALID_BUYER' });
    patch.buyer = { fullName, email, phone };
  }
  if (input.delivery !== undefined) {
    const d = input.delivery;
    if (
      !record(d) ||
      Object.keys(d).some(
        (k) =>
          ![
            'recipientName',
            'phone',
            'addressLine1',
            'addressLine2',
            'city',
            'region',
            'country',
            'postalCode',
          ].includes(k),
      )
    )
      return err({ kind: 'INVALID_DELIVERY' });
    const recipientName = text(d, 'recipientName', 2, 120),
      phone = text(d, 'phone', 2, 16),
      addressLine1 = text(d, 'addressLine1', 3, 200),
      city = text(d, 'city', 2, 100),
      region = text(d, 'region', 2, 100);
    if (
      !recipientName ||
      !phone ||
      !addressLine1 ||
      !city ||
      !region ||
      text(d, 'country', 2, 2) !== 'CO' ||
      !/^\+[1-9]\d{1,14}$/.test(phone)
    )
      return err({ kind: 'INVALID_DELIVERY' });
    const delivery: Delivery = {
      recipientName,
      phone,
      addressLine1,
      city,
      region,
      country: 'CO',
    };
    for (const [key, max] of [
      ['addressLine2', 200],
      ['postalCode', 12],
    ] as const) {
      if (d[key] !== undefined && d[key] !== null) {
        const value = text(d, key, 1, max);
        if (!value) return err({ kind: 'INVALID_DELIVERY' });
        delivery[key] = value;
      } else if (d[key] === null) delivery[key] = null;
    }
    patch.delivery = delivery;
  }
  return ok(patch);
}
export function calculateSummary(
  source: Omit<Summary, 'subtotalCents' | 'totalCents'>,
): Result<Summary, CheckoutError> {
  if (!validQuantity(source.quantity) || source.unitPriceCents <= 0)
    return err({ kind: 'INVALID_AMOUNT' });
  return Money.fromCents(source.unitPriceCents, source.currency)
    .andThen((price) => price.multiply(source.quantity))
    .andThen((subtotal) =>
      Money.fromCents(source.baseFeeCents, source.currency)
        .andThen((base) => subtotal.add(base))
        .andThen((total) =>
          Money.fromCents(source.deliveryFeeCents, source.currency).andThen(
            (delivery) => total.add(delivery),
          ),
        )
        .map((total) => ({
          ...source,
          subtotalCents: subtotal.cents,
          totalCents: total.cents,
        })),
    )
    .mapErr((): CheckoutError => ({ kind: 'INVALID_AMOUNT' }));
}

export function calculateDraftSummary(
  quantity: number,
  unitPriceCents: number,
  currency: string,
) {
  return calculateSummary({
    quantity,
    unitPriceCents,
    currency,
    baseFeeCents: 50000,
    deliveryFeeCents: 100000,
  });
}
