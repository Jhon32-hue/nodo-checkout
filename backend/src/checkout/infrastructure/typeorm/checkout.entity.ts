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
import { CheckoutSessionOrmEntity } from './checkout-session.entity';
import { CustomerOrmEntity } from './customer.entity';
import { ProductOrmEntity } from '../../../catalog/infrastructure/typeorm/product.entity';

@Entity('checkouts')
@Unique('uq_checkouts_customer', ['customerId'])
@Index('ix_checkouts_session', ['sessionId'])
@Check('ck_checkouts_quantity', 'quantity BETWEEN 1 AND 99')
@Check('ck_checkouts_status', "status IN ('DRAFT', 'PAYMENT_PENDING', 'PAID')")
@Check(
  'ck_checkouts_delivery',
  "delivery_draft IS NULL OR jsonb_typeof(delivery_draft) = 'object'",
)
@Check(
  'ck_checkouts_complete',
  "status = 'DRAFT' OR (customer_id IS NOT NULL AND delivery_draft IS NOT NULL)",
)
export class CheckoutOrmEntity extends PersistedEntity {
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ name: 'quantity', type: 'smallint' })
  quantity!: number;

  @Column({ name: 'delivery_draft', type: 'jsonb', nullable: true })
  deliveryDraft!: Record<string, unknown> | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'DRAFT' })
  status!: 'DRAFT' | 'PAYMENT_PENDING' | 'PAID';

  @ManyToOne(() => CheckoutSessionOrmEntity, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({
    name: 'session_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_checkouts_session',
  })
  session!: Relation<CheckoutSessionOrmEntity>;

  @ManyToOne(() => ProductOrmEntity, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'product_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_checkouts_product',
  })
  product!: Relation<ProductOrmEntity>;

  @ManyToOne(() => CustomerOrmEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'customer_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_checkouts_customer',
  })
  customer!: Relation<CustomerOrmEntity> | null;
}
