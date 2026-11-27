import type { Summary } from './checkout';
export type AcceptedSummary = Omit<Summary, 'subtotalCents' | 'totalCents'>;
export interface AttemptView {
  id: string;
  checkoutId: string;
  status: string;
  dispatchStatus: string;
  reservationExpiresAt: string;
  deliveryId: string | null;
}
export interface AttemptDetails extends AttemptView {
  reference: string;
  summary: Summary;
  createdAt: string;
  finalizedAt: string | null;
  reservationStatus: string;
  reservationExpired: boolean;
}
export interface PurchaseHistoryItem {
  id: string;
  checkoutId: string;
  productName: string;
  quantity: number;
  totalCents: number;
  currency: 'COP';
  reference: string;
  status: string;
  dispatchStatus: string;
  createdAt: string;
  deliveryId: string | null;
}
export function canonicalRequest(
  checkoutId: string,
  s: AcceptedSummary,
): string {
  return JSON.stringify([
    checkoutId.toLowerCase(),
    s.quantity,
    s.unitPriceCents,
    s.baseFeeCents,
    s.deliveryFeeCents,
    s.currency,
  ]);
}
export function matchesSummary(a: AcceptedSummary, b: Summary): boolean {
  return (
    a.quantity === b.quantity &&
    a.unitPriceCents === b.unitPriceCents &&
    a.baseFeeCents === b.baseFeeCents &&
    a.deliveryFeeCents === b.deliveryFeeCents &&
    a.currency === b.currency
  );
}
export function canExpire(
  dispatchStatus: string,
  status: string,
  expiresAt: Date,
  now: Date,
): boolean {
  return dispatchStatus === 'NOT_SENT' && status === 'HELD' && expiresAt <= now;
}
