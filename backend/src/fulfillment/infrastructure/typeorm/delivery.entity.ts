import { Check, Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { PersistedEntity } from '../../../infrastructure/database/persisted.entity';
import { CheckoutOrmEntity } from '../../../checkout/infrastructure/typeorm/checkout.entity';
import { TransactionOrmEntity } from '../../../checkout/infrastructure/typeorm/transaction.entity';

@Entity('deliveries')
@Unique('uq_deliveries_checkout', ['checkoutId'])
@Unique('uq_deliveries_transaction', ['transactionId'])
@Check('ck_deliveries_status', "status = 'READY'")
export class DeliveryOrmEntity extends PersistedEntity {
  @Column({ name: 'checkout_id', type: 'uuid' })
  checkoutId!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'READY' })
  status!: 'READY';

  @ManyToOne(() => CheckoutOrmEntity, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'checkout_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_deliveries_checkout',
  })
  checkout!: Relation<CheckoutOrmEntity>;

  @ManyToOne(() => TransactionOrmEntity, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn([
    {
      name: 'transaction_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_deliveries_attempt',
    },
    { name: 'checkout_id', referencedColumnName: 'checkoutId' },
  ])
  transaction!: Relation<TransactionOrmEntity>;
}
