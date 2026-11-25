import type { ResultAsync } from 'neverthrow';
import type {
  CheckoutError,
  CheckoutRecord,
  CheckoutView,
  Patch,
} from '../domain/checkout';
export interface Session {
  id: string;
  expiresAt: Date;
}
export interface SessionStore {
  find(digest: string, now: Date): ResultAsync<Session | null, CheckoutError>;
  create(digest: string, expiresAt: Date): ResultAsync<Session, CheckoutError>;
}
export interface SessionTokens {
  generate(): string;
  digest(token: string): string;
  csrf(token: string): string;
  verify(token: string, csrf: string): boolean;
}
export interface CheckoutStore {
  create(
    sessionId: string,
    productId: string,
    quantity: number,
  ): ResultAsync<CheckoutView, CheckoutError>;
  get(
    sessionId: string,
    id: string,
  ): ResultAsync<CheckoutRecord, CheckoutError>;
  update(
    sessionId: string,
    id: string,
    patch: Patch,
  ): ResultAsync<CheckoutView, CheckoutError>;
}
