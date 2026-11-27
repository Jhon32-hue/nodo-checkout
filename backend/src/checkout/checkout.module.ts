import { PaymentsController } from '../payments/infrastructure/payments.controller';
import { TypeOrmPaymentStore } from '../payments/infrastructure/payment.store';
import { WompiPaymentGateway } from '../payments/infrastructure/wompi.gateway';
import { PAYMENT_GATEWAY } from '../payments/application/payment-ports';
import type { PaymentGateway } from '../payments/application/payment-ports';
import {
  GetPaymentConfig,
  StartPayment,
  SyncPayment,
  FinalizePayment,
} from '../payments/application/payment-cases';
import { createHash } from 'node:crypto';
import { TransactionsController } from './infrastructure/http/transactions.controller';
import { TypeOrmTransactionStore } from './infrastructure/typeorm/transaction.store';
import {
  CreateTransaction,
  GetTransaction,
  ListTransactions,
} from './application/transaction-cases';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TypeOrmSessionStore,
  TypeOrmCheckoutStore,
} from './infrastructure/typeorm/checkout.store';
import {
  CryptoSessionTokens,
  CheckoutGuard,
} from './infrastructure/http/session-security';
import { CheckoutsController } from './infrastructure/http/checkouts.controller';
import {
  EnsureCheckoutSession,
  AuthenticateSession,
  CreateCheckout,
  GetCheckout,
  UpdateCheckout,
  GetSummary,
} from './application/checkout-cases';
@Module({
  controllers: [
    CheckoutsController,
    TransactionsController,
    PaymentsController,
  ],
  providers: [
    TypeOrmPaymentStore,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        new WompiPaymentGateway({
          baseUrl: c.get<string>('WOMPI_BASE_URL'),
          publicKey: c.get<string>('WOMPI_PUBLIC_KEY'),
          privateKey: c.get<string>('WOMPI_PRIVATE_KEY'),
          integritySecret: c.get<string>('WOMPI_INTEGRITY_SECRET'),
        }),
    },
    {
      provide: GetPaymentConfig,
      inject: [PAYMENT_GATEWAY],
      useFactory: (g: PaymentGateway) => new GetPaymentConfig(g),
    },
    {
      provide: FinalizePayment,
      inject: [TypeOrmPaymentStore],
      useFactory: (s: TypeOrmPaymentStore) => new FinalizePayment(s),
    },
    {
      provide: StartPayment,
      inject: [TypeOrmPaymentStore, PAYMENT_GATEWAY, FinalizePayment],
      useFactory: (
        s: TypeOrmPaymentStore,
        g: PaymentGateway,
        f: FinalizePayment,
      ) =>
        new StartPayment(
          s,
          g,
          { hash: (value) => createHash('sha256').update(value).digest('hex') },
          f,
        ),
    },
    {
      provide: SyncPayment,
      inject: [TypeOrmPaymentStore, PAYMENT_GATEWAY, FinalizePayment],
      useFactory: (
        s: TypeOrmPaymentStore,
        g: PaymentGateway,
        f: FinalizePayment,
      ) => new SyncPayment(s, g, f),
    },
    TypeOrmTransactionStore,
    {
      provide: CreateTransaction,
      inject: [TypeOrmTransactionStore],
      useFactory: (store: TypeOrmTransactionStore) =>
        new CreateTransaction(store, {
          hash: (canonical) =>
            createHash('sha256').update(canonical).digest('hex'),
        }),
    },
    {
      provide: GetTransaction,
      inject: [TypeOrmTransactionStore],
      useFactory: (store: TypeOrmTransactionStore) => new GetTransaction(store),
    },
    {
      provide: ListTransactions,
      inject: [TypeOrmTransactionStore],
      useFactory: (store: TypeOrmTransactionStore) =>
        new ListTransactions(store),
    },
    TypeOrmSessionStore,
    TypeOrmCheckoutStore,
    CheckoutGuard,
    {
      provide: CryptoSessionTokens,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CryptoSessionTokens(
          config.getOrThrow<string>('CSRF_SECRET'),
          (
            config.get<string>('FRONTEND_ORIGINS') ??
            'http://localhost:3000,http://localhost:5173'
          )
            .split(',')
            .map((s) => s.trim()),
        ),
    },
    {
      provide: EnsureCheckoutSession,
      inject: [TypeOrmSessionStore, CryptoSessionTokens],
      useFactory: (store: TypeOrmSessionStore, tokens: CryptoSessionTokens) =>
        new EnsureCheckoutSession(store, tokens),
    },
    {
      provide: AuthenticateSession,
      inject: [TypeOrmSessionStore, CryptoSessionTokens],
      useFactory: (store: TypeOrmSessionStore, tokens: CryptoSessionTokens) =>
        new AuthenticateSession(store, tokens),
    },
    ...[CreateCheckout, GetCheckout, UpdateCheckout, GetSummary].map(
      (useCase) => ({
        provide: useCase,
        inject: [TypeOrmCheckoutStore],
        useFactory: (store: TypeOrmCheckoutStore) => new useCase(store),
      }),
    ),
  ],
})
export class CheckoutModule {}
