import type { DataSourceOptions } from 'typeorm';
import type { Environment } from '../../config/environment';
import { ProductOrmEntity } from '../../catalog/infrastructure/typeorm/product.entity';
import { InventoryReservationOrmEntity } from '../../catalog/infrastructure/typeorm/inventory-reservation.entity';
import { CheckoutSessionOrmEntity } from '../../checkout/infrastructure/typeorm/checkout-session.entity';
import { CustomerOrmEntity } from '../../checkout/infrastructure/typeorm/customer.entity';
import { CheckoutOrmEntity } from '../../checkout/infrastructure/typeorm/checkout.entity';
import { TransactionOrmEntity } from '../../checkout/infrastructure/typeorm/transaction.entity';
import { DeliveryOrmEntity } from '../../fulfillment/infrastructure/typeorm/delivery.entity';
import { InitialSchema1795632838292 } from './migrations/1795632838292-InitialSchema';

type DatabaseEnvironment = Pick<
  Environment,
  'DB_HOST' | 'DB_PORT' | 'DB_USER' | 'DB_PASSWORD' | 'DB_NAME'
>;

export function createDatabaseOptions(
  env: DatabaseEnvironment,
): Extract<DataSourceOptions, { type: 'postgres' }> {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [
      ProductOrmEntity,
      CheckoutSessionOrmEntity,
      CustomerOrmEntity,
      CheckoutOrmEntity,
      TransactionOrmEntity,
      InventoryReservationOrmEntity,
      DeliveryOrmEntity,
    ],
    migrations: [InitialSchema1795632838292],
    synchronize: false,
    migrationsRun: false,
  };
}
