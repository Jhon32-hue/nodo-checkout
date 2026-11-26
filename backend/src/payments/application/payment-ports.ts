import type { Result, ResultAsync } from 'neverthrow';
import type { AttemptView } from '../../checkout/domain/transaction';
import type {
  PayInput,
  PublicPaymentConfig,
  GatewayError,
  PaymentError,
  PaymentRecord,
  Observation,
  AcceptanceEvidence,
} from '../domain/payment';
export interface GatewayCreate {
  record: PaymentRecord;
  input: PayInput;
}
export interface PaymentGateway {
  configuration: () => ResultAsync<PublicPaymentConfig, GatewayError>;
  validateAcceptance: (input: PayInput) => ResultAsync<void, GatewayError>;
  create: (input: GatewayCreate) => ResultAsync<Observation, GatewayError>;
  get: (
    id: string,
    context?: { localId: string; reference: string },
  ) => ResultAsync<Observation, GatewayError>;
}
export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
export interface PaymentContext {
  record: PaymentRecord;
  claim(hash: string, evidence: AcceptanceEvidence, now: Date): Promise<void>;
  expire(now: Date): Promise<void>;
  submitted(providerId: string): Promise<void>;
  unknown(reason?: string): Promise<void>;
  observe(observation: Observation, now: Date): Promise<void>;
  view(): Promise<AttemptView>;
}
export interface PaymentStore {
  read(sessionId: string, id: string): ResultAsync<PaymentRecord, PaymentError>;
  run<T>(
    sessionId: string,
    id: string,
    work: (ctx: PaymentContext) => Promise<Result<T, PaymentError>>,
  ): ResultAsync<T, PaymentError>;
}
export interface PaymentHash {
  hash(value: string): string;
}
