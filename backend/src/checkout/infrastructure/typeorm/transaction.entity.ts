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
import { CheckoutOrmEntity } from './checkout.entity';
import { ProductOrmEntity } from '../../../catalog/infrastructure/typeorm/product.entity';

@Entity('transactions')
@Unique('uq_transactions_attempt', ['checkoutId', 'attemptNumber'])
@Unique('uq_transactions_reference', ['reference'])
@Unique('uq_transactions_idempotency', ['checkoutId', 'idempotencyKey'])
@Unique('uq_transactions_provider', [
  'providerEnvironment',
  'providerTransactionId',
])
@Unique('uq_transactions_id_checkout', ['id', 'checkoutId'])
@Unique('uq_transactions_reservation_target', ['id', 'productId', 'quantity'])
@Index('ix_transactions_checkout_created', ['checkoutId', 'createdAt'])
@Index('uq_transactions_active', ['checkoutId'], {
  unique: true,
  where: "status = 'PENDING'",
})
@Index('uq_transactions_approved', ['checkoutId'], {
  unique: true,
  where: "status = 'APPROVED'",
})
@Check('ck_transactions_quantity', 'quantity BETWEEN 1 AND 99')
@Check('ck_transactions_attempt_number', 'attempt_number > 0')
@Check(
  'ck_transactions_money',
  "unit_price_cents BETWEEN 1 AND 2000000000 AND base_fee_cents BETWEEN 0 AND 2000000000 AND delivery_fee_cents BETWEEN 0 AND 2000000000 AND quantity::bigint * unit_price_cents + base_fee_cents::bigint + delivery_fee_cents BETWEEN 1 AND 2000000000 AND currency = 'COP'",
)
@Check(
  'ck_transactions_hashes',
  "create_request_hash ~ '^[0-9a-f]{64}$' AND (pay_request_hash IS NULL OR pay_request_hash ~ '^[0-9a-f]{64}$')",
)
@Check(
  'ck_transactions_snapshots',
  "jsonb_typeof(buyer_snapshot) = 'object' AND jsonb_typeof(delivery_snapshot) = 'object' AND (acceptance_evidence IS NULL OR jsonb_typeof(acceptance_evidence) = 'object')",
)
@Check(
  'ck_transactions_text',
  "btrim(reference) <> '' AND btrim(product_name) <> '' AND btrim(product_description) <> '' AND (provider_transaction_id IS NULL OR btrim(provider_transaction_id) <> '')",
)
@Check('ck_transactions_environment', "provider_environment = 'UAT_SANDBOX'")
@Check(
  'ck_transactions_status',
  "(status = 'PENDING' AND dispatch_status IN ('NOT_SENT', 'IN_FLIGHT', 'SUBMITTED', 'UNKNOWN')) OR (status IN ('APPROVED', 'DECLINED', 'VOIDED') AND dispatch_status = 'SUBMITTED') OR (status = 'ERROR' AND dispatch_status IN ('SUBMITTED', 'NOT_CREATED')) OR (status = 'EXPIRED' AND dispatch_status = 'NOT_SENT')",
)
@Check(
  'ck_transactions_dispatch',
  "(dispatch_status = 'NOT_SENT' AND submission_started_at IS NULL AND pay_request_hash IS NULL AND acceptance_evidence IS NULL AND provider_transaction_id IS NULL) OR (dispatch_status IN ('IN_FLIGHT', 'UNKNOWN', 'NOT_CREATED', 'SUBMITTED') AND submission_started_at IS NOT NULL AND pay_request_hash IS NOT NULL AND acceptance_evidence IS NOT NULL AND ((dispatch_status = 'SUBMITTED' AND provider_transaction_id IS NOT NULL) OR (dispatch_status <> 'SUBMITTED' AND provider_transaction_id IS NULL)))",
)
@Check(
  'ck_transactions_finalized',
  "(status = 'PENDING' AND finalized_at IS NULL) OR (status <> 'PENDING' AND finalized_at IS NOT NULL)",
)
export class TransactionOrmEntity extends PersistedEntity {
  @Column({ name: 'checkout_id', type: 'uuid' })
  checkoutId!: string;

  @Column({ name: 'attempt_number', type: 'integer' })
  attemptNumber!: number;

  @Column({ name: 'reference', type: 'varchar', length: 64 })
  reference!: string;

  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey!: string;

  @Column({ name: 'create_request_hash', type: 'char', length: 64 })
  createRequestHash!: string;

  @Column({
    name: 'pay_request_hash',
    type: 'char',
    nullable: true,
    length: 64,
  })
  payRequestHash!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | 'EXPIRED';

  @Column({
    name: 'dispatch_status',
    type: 'varchar',
    length: 32,
    default: 'NOT_SENT',
  })
  dispatchStatus!:
    'NOT_SENT' | 'IN_FLIGHT' | 'SUBMITTED' | 'UNKNOWN' | 'NOT_CREATED';

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    nullable: true,
    length: 64,
  })
  lastErrorCode!: string | null;

  @Column({
    name: 'provider_transaction_id',
    type: 'varchar',
    nullable: true,
    length: 128,
  })
  providerTransactionId!: string | null;

  @Column({
    name: 'provider_environment',
    type: 'varchar',
    length: 16,
    default: 'UAT_SANDBOX',
  })
  providerEnvironment!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 120 })
  productName!: string;

  @Column({ name: 'product_description', type: 'text' })
  productDescription!: string;

  @Column({ name: 'quantity', type: 'smallint' })
  quantity!: number;

  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents!: number;

  @Column({ name: 'base_fee_cents', type: 'integer' })
  baseFeeCents!: number;

  @Column({ name: 'delivery_fee_cents', type: 'integer' })
  deliveryFeeCents!: number;

  @Column({ name: 'currency', type: 'char', length: 3, default: 'COP' })
  currency!: string;

  @Column({ name: 'buyer_snapshot', type: 'jsonb' })
  buyerSnapshot!: Record<string, unknown>;

  @Column({ name: 'delivery_snapshot', type: 'jsonb' })
  deliverySnapshot!: Record<string, unknown>;

  @Column({ name: 'acceptance_evidence', type: 'jsonb', nullable: true })
  acceptanceEvidence!: Record<string, unknown> | null;

  @Column({
    name: 'submission_started_at',
    type: 'timestamptz',
    nullable: true,
  })
  submissionStartedAt!: Date | null;

  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt!: Date | null;

  @ManyToOne(() => CheckoutOrmEntity, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'checkout_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_transactions_checkout',
  })
  checkout!: Relation<CheckoutOrmEntity>;

  @ManyToOne(() => ProductOrmEntity, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'product_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_transactions_product',
  })
  product!: Relation<ProductOrmEntity>;
}
