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
  controllers: [CheckoutsController],
  providers: [
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
