import type { Result, ResultAsync } from 'neverthrow';
import type {
  Buyer,
  Delivery,
  CheckoutError,
  Summary,
} from '../domain/checkout';
import type {
  AttemptView,
  AttemptDetails,
  PurchaseHistoryItem,
} from '../domain/transaction';
export interface LockedCheckout {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  buyer: Buyer | null;
  delivery: Record<string, unknown> | null;
}
export interface ActiveAttempt {
  id: string;
  dispatchStatus: string;
}
export interface Reservation {
  id: string;
  status: string;
  expiresAt: Date;
}
export interface LockedProduct {
  id: string;
  name: string;
  description: string;
  active: boolean;
  unitPriceCents: number;
  currency: string;
  stock: number;
}
export interface AttemptWrite {
  product: LockedProduct;
  buyer: Buyer;
  delivery: Delivery;
  summary: Summary;
  key: string;
  hash: string;
  expiresAt: Date;
}
export interface AttemptContext {
  checkout: LockedCheckout;
  replay(
    this: void,
    key: string,
  ): Promise<{ hash: string; view: AttemptView } | null>;
  lockActive(this: void): Promise<ActiveAttempt | null>;
  lockProduct(this: void): Promise<LockedProduct>;
  lockReservation(this: void, attemptId: string): Promise<Reservation>;
  expire(
    this: void,
    attempt: ActiveAttempt,
    reservation: Reservation,
    now: Date,
  ): Promise<void>;
  available(this: void, now: Date): Promise<number>;
  insert(this: void, input: AttemptWrite): Promise<AttemptView>;
}
export interface TransactionStore {
  run(
    sessionId: string,
    checkoutId: string,
    work: (
      context: AttemptContext,
    ) => Promise<Result<AttemptView, CheckoutError>>,
  ): ResultAsync<AttemptView, CheckoutError>;
  get(
    sessionId: string,
    id: string,
    now: Date,
  ): ResultAsync<AttemptDetails, CheckoutError>;
  list(sessionId: string): ResultAsync<PurchaseHistoryItem[], CheckoutError>;
}
export interface TransactionIdentity {
  hash(canonical: string): string;
}
