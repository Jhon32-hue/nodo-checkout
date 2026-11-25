import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1795632838292 implements MigrationInterface {
  name = 'InitialSchema1795632838292';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "sku" character varying(64) NOT NULL, "name" character varying(120) NOT NULL, "description" text NOT NULL, "image_url" character varying(2048) NOT NULL, "unit_price_cents" integer NOT NULL, "currency" character(3) NOT NULL DEFAULT 'COP', "stock" integer NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "uq_products_sku" UNIQUE ("sku"), CONSTRAINT "ck_products_stock" CHECK (stock BETWEEN 0 AND 1000000), CONSTRAINT "ck_products_money" CHECK (unit_price_cents BETWEEN 1 AND 2000000000 AND currency = 'COP'), CONSTRAINT "ck_products_text" CHECK (btrim(sku) <> '' AND btrim(name) <> '' AND btrim(description) <> '' AND image_url LIKE 'https://%'), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "checkout_sessions" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "token_digest" bytea NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "uq_checkout_sessions_token" UNIQUE ("token_digest"), CONSTRAINT "ck_checkout_sessions_digest" CHECK (octet_length(token_digest) = 32), CONSTRAINT "PK_5730b2bbc190203a94941d82bd1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "full_name" character varying(120) NOT NULL, "email" character varying(254) NOT NULL, "phone" character varying(16) NOT NULL, CONSTRAINT "ck_customers_text" CHECK (btrim(full_name) <> '' AND btrim(email) <> '' AND btrim(phone) <> ''), CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "checkouts" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "session_id" uuid NOT NULL, "product_id" uuid NOT NULL, "customer_id" uuid, "quantity" smallint NOT NULL, "delivery_draft" jsonb, "status" character varying(32) NOT NULL DEFAULT 'DRAFT', CONSTRAINT "uq_checkouts_customer" UNIQUE ("customer_id"), CONSTRAINT "ck_checkouts_complete" CHECK (status = 'DRAFT' OR (customer_id IS NOT NULL AND delivery_draft IS NOT NULL)), CONSTRAINT "ck_checkouts_delivery" CHECK (delivery_draft IS NULL OR jsonb_typeof(delivery_draft) = 'object'), CONSTRAINT "ck_checkouts_status" CHECK (status IN ('DRAFT', 'PAYMENT_PENDING', 'PAID')), CONSTRAINT "ck_checkouts_quantity" CHECK (quantity BETWEEN 1 AND 99), CONSTRAINT "PK_5800730d89f4137fc18770e4d4d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_checkouts_session" ON "checkouts"  ("session_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "transactions" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "checkout_id" uuid NOT NULL, "attempt_number" integer NOT NULL, "reference" character varying(64) NOT NULL, "idempotency_key" uuid NOT NULL, "create_request_hash" character(64) NOT NULL, "pay_request_hash" character(64), "status" character varying(32) NOT NULL DEFAULT 'PENDING', "dispatch_status" character varying(32) NOT NULL DEFAULT 'NOT_SENT', "last_error_code" character varying(64), "provider_transaction_id" character varying(128), "provider_environment" character varying(16) NOT NULL DEFAULT 'UAT_SANDBOX', "product_id" uuid NOT NULL, "product_name" character varying(120) NOT NULL, "product_description" text NOT NULL, "quantity" smallint NOT NULL, "unit_price_cents" integer NOT NULL, "base_fee_cents" integer NOT NULL, "delivery_fee_cents" integer NOT NULL, "currency" character(3) NOT NULL DEFAULT 'COP', "buyer_snapshot" jsonb NOT NULL, "delivery_snapshot" jsonb NOT NULL, "acceptance_evidence" jsonb, "submission_started_at" TIMESTAMP WITH TIME ZONE, "finalized_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_transactions_reservation_target" UNIQUE ("id", "product_id", "quantity"), CONSTRAINT "uq_transactions_id_checkout" UNIQUE ("id", "checkout_id"), CONSTRAINT "uq_transactions_provider" UNIQUE ("provider_environment", "provider_transaction_id"), CONSTRAINT "uq_transactions_idempotency" UNIQUE ("checkout_id", "idempotency_key"), CONSTRAINT "uq_transactions_reference" UNIQUE ("reference"), CONSTRAINT "uq_transactions_attempt" UNIQUE ("checkout_id", "attempt_number"), CONSTRAINT "ck_transactions_finalized" CHECK ((status = 'PENDING' AND finalized_at IS NULL) OR (status <> 'PENDING' AND finalized_at IS NOT NULL)), CONSTRAINT "ck_transactions_dispatch" CHECK ((dispatch_status = 'NOT_SENT' AND submission_started_at IS NULL AND pay_request_hash IS NULL AND acceptance_evidence IS NULL AND provider_transaction_id IS NULL) OR (dispatch_status IN ('IN_FLIGHT', 'UNKNOWN', 'NOT_CREATED', 'SUBMITTED') AND submission_started_at IS NOT NULL AND pay_request_hash IS NOT NULL AND acceptance_evidence IS NOT NULL AND ((dispatch_status = 'SUBMITTED' AND provider_transaction_id IS NOT NULL) OR (dispatch_status <> 'SUBMITTED' AND provider_transaction_id IS NULL)))), CONSTRAINT "ck_transactions_status" CHECK ((status = 'PENDING' AND dispatch_status IN ('NOT_SENT', 'IN_FLIGHT', 'SUBMITTED', 'UNKNOWN')) OR (status IN ('APPROVED', 'DECLINED', 'VOIDED') AND dispatch_status = 'SUBMITTED') OR (status = 'ERROR' AND dispatch_status IN ('SUBMITTED', 'NOT_CREATED')) OR (status = 'EXPIRED' AND dispatch_status = 'NOT_SENT')), CONSTRAINT "ck_transactions_environment" CHECK (provider_environment = 'UAT_SANDBOX'), CONSTRAINT "ck_transactions_text" CHECK (btrim(reference) <> '' AND btrim(product_name) <> '' AND btrim(product_description) <> '' AND (provider_transaction_id IS NULL OR btrim(provider_transaction_id) <> '')), CONSTRAINT "ck_transactions_snapshots" CHECK (jsonb_typeof(buyer_snapshot) = 'object' AND jsonb_typeof(delivery_snapshot) = 'object' AND (acceptance_evidence IS NULL OR jsonb_typeof(acceptance_evidence) = 'object')), CONSTRAINT "ck_transactions_hashes" CHECK (create_request_hash ~ '^[0-9a-f]{64}$' AND (pay_request_hash IS NULL OR pay_request_hash ~ '^[0-9a-f]{64}$')), CONSTRAINT "ck_transactions_money" CHECK (unit_price_cents BETWEEN 1 AND 2000000000 AND base_fee_cents BETWEEN 0 AND 2000000000 AND delivery_fee_cents BETWEEN 0 AND 2000000000 AND quantity::bigint * unit_price_cents + base_fee_cents::bigint + delivery_fee_cents BETWEEN 1 AND 2000000000 AND currency = 'COP'), CONSTRAINT "ck_transactions_attempt_number" CHECK (attempt_number > 0), CONSTRAINT "ck_transactions_quantity" CHECK (quantity BETWEEN 1 AND 99), CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_transactions_approved" ON "transactions"  ("checkout_id") WHERE status = 'APPROVED'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_transactions_active" ON "transactions"  ("checkout_id") WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_transactions_checkout_created" ON "transactions"  ("checkout_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_reservations" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "transaction_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" smallint NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'HELD', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "uq_reservations_transaction" UNIQUE ("transaction_id"), CONSTRAINT "ck_reservations_status" CHECK (status IN ('HELD', 'CONFIRMED', 'RELEASED')), CONSTRAINT "ck_reservations_quantity" CHECK (quantity BETWEEN 1 AND 99), CONSTRAINT "PK_af438c0ce596eea6c4d472a0489" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_reservations_product_status" ON "inventory_reservations"  ("product_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "deliveries" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "checkout_id" uuid NOT NULL, "transaction_id" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'READY', CONSTRAINT "uq_deliveries_transaction" UNIQUE ("transaction_id"), CONSTRAINT "uq_deliveries_checkout" UNIQUE ("checkout_id"), CONSTRAINT "ck_deliveries_status" CHECK (status = 'READY'), CONSTRAINT "PK_a6ef225c5c5f0974e503bfb731f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkouts" ADD CONSTRAINT "fk_checkouts_session" FOREIGN KEY ("session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkouts" ADD CONSTRAINT "fk_checkouts_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkouts" ADD CONSTRAINT "fk_checkouts_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_checkout" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations" ADD CONSTRAINT "fk_reservations_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations" ADD CONSTRAINT "fk_reservations_attempt" FOREIGN KEY ("transaction_id", "product_id", "quantity") REFERENCES "transactions"("id","product_id","quantity") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" ADD CONSTRAINT "fk_deliveries_checkout" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" ADD CONSTRAINT "fk_deliveries_attempt" FOREIGN KEY ("transaction_id", "checkout_id") REFERENCES "transactions"("id","checkout_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deliveries" DROP CONSTRAINT "fk_deliveries_attempt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" DROP CONSTRAINT "fk_deliveries_checkout"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations" DROP CONSTRAINT "fk_reservations_attempt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations" DROP CONSTRAINT "fk_reservations_product"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "fk_transactions_product"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "fk_transactions_checkout"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkouts" DROP CONSTRAINT "fk_checkouts_customer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkouts" DROP CONSTRAINT "fk_checkouts_product"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkouts" DROP CONSTRAINT "fk_checkouts_session"`,
    );
    await queryRunner.query(`DROP TABLE "deliveries"`);
    await queryRunner.query(
      `DROP INDEX "public"."ix_reservations_product_status"`,
    );
    await queryRunner.query(`DROP TABLE "inventory_reservations"`);
    await queryRunner.query(
      `DROP INDEX "public"."ix_transactions_checkout_created"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_transactions_active"`);
    await queryRunner.query(`DROP INDEX "public"."uq_transactions_approved"`);
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP INDEX "public"."ix_checkouts_session"`);
    await queryRunner.query(`DROP TABLE "checkouts"`);
    await queryRunner.query(`DROP TABLE "customers"`);
    await queryRunner.query(`DROP TABLE "checkout_sessions"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
