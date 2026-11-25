import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { PersistedEntity } from '../../../infrastructure/database/persisted.entity';
import { ProductOrmEntity } from './product.entity';
import { TransactionOrmEntity } from '../../../checkout/infrastructure/typeorm/transaction.entity';

@Entity('inventory_reservations')
@Unique('uq_reservations_transaction', ['transactionId'])
@Index('ix_reservations_product_status', ['productId', 'status'])
@Check('ck_reservations_quantity', 'quantity BETWEEN 1 AND 99')
@Check('ck_reservations_status', "status IN ('HELD', 'CONFIRMED', 'RELEASED')")
export class InventoryReservationOrmEntity extends PersistedEntity {
  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'quantity', type: 'smallint' })
  quantity!: number;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'HELD' })
  status!: 'HELD' | 'CONFIRMED' | 'RELEASED';

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @ManyToOne(() => ProductOrmEntity, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'product_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_reservations_product',
  })
  product!: Relation<ProductOrmEntity>;

  @ManyToOne(() => TransactionOrmEntity, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn([
    {
      name: 'transaction_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_reservations_attempt',
    },
    { name: 'product_id', referencedColumnName: 'productId' },
    { name: 'quantity', referencedColumnName: 'quantity' },
  ])
  transaction!: Relation<TransactionOrmEntity>;
}
