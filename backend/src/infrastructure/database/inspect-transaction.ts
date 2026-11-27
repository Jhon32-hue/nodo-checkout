import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from './database-options';
import { loadDatabaseEnvironment } from './load-environment';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTransactionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('INVALID_TRANSACTION_ID');
  return value.toLowerCase();
}

type InspectionRow = {
  transactionId: string;
  attemptNumber: number | string;
  reference: string;
  transactionStatus: string;
  dispatchStatus: string;
  lastErrorCode: string | null;
  providerEnvironment: string;
  providerTransactionId: string | null;
  quantity: number | string;
  unitPriceCents: number | string;
  baseFeeCents: number | string;
  deliveryFeeCents: number | string;
  totalCents: number | string;
  currency: string;
  transactionCreatedAt: Date | string;
  submissionStartedAt: Date | string | null;
  finalizedAt: Date | string | null;
  checkoutId: string;
  checkoutStatus: string;
  productId: string;
  sku: string;
  physicalStock: number | string;
  activeHeld: number | string;
  available: number | string;
  reservationId: string;
  reservationStatus: string;
  reservationExpiresAt: Date | string;
  deliveryId: string | null;
  deliveryStatus: string | null;
};

const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();

export function formatCopCents(value: number | string): string {
  const raw = String(value);
  if (!/^-?\d+$/.test(raw)) throw new Error('INVALID_COP_CENTS');
  const cents = BigInt(raw);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const pesos = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$ ${pesos},${fraction} COP`;
}

export function sanitizeInspection(row: InspectionRow) {
  return {
    transaction: {
      id: row.transactionId,
      attemptNumber: Number(row.attemptNumber),
      reference: row.reference,
      status: row.transactionStatus,
      dispatchStatus: row.dispatchStatus,
      lastErrorCode: row.lastErrorCode,
      providerEnvironment: row.providerEnvironment,
      providerTransactionPresent: row.providerTransactionId !== null,
      providerTransactionFingerprint: row.providerTransactionId
        ? createHash('sha256')
            .update(row.providerTransactionId)
            .digest('hex')
            .slice(0, 16)
        : null,
      quantity: Number(row.quantity),
      amounts: {
        unitPriceCents: Number(row.unitPriceCents),
        unitPriceCop: formatCopCents(row.unitPriceCents),
        baseFeeCents: Number(row.baseFeeCents),
        baseFeeCop: formatCopCents(row.baseFeeCents),
        deliveryFeeCents: Number(row.deliveryFeeCents),
        deliveryFeeCop: formatCopCents(row.deliveryFeeCents),
        totalCents: Number(row.totalCents),
        totalCop: formatCopCents(row.totalCents),
        currency: row.currency,
      },
      createdAt: iso(row.transactionCreatedAt),
      submissionStartedAt: iso(row.submissionStartedAt),
      finalizedAt: iso(row.finalizedAt),
    },
    checkout: { id: row.checkoutId, status: row.checkoutStatus },
    reservation: {
      id: row.reservationId,
      status: row.reservationStatus,
      expiresAt: iso(row.reservationExpiresAt),
    },
    inventory: {
      productId: row.productId,
      sku: row.sku,
      physicalStock: Number(row.physicalStock),
      activeHeld: Number(row.activeHeld),
      available: Number(row.available),
    },
    delivery: row.deliveryId
      ? { id: row.deliveryId, status: row.deliveryStatus }
      : null,
  };
}

const query = `
  SELECT
    t.id AS "transactionId",
    t.attempt_number AS "attemptNumber",
    t.reference,
    t.status AS "transactionStatus",
    t.dispatch_status AS "dispatchStatus",
    t.last_error_code AS "lastErrorCode",
    t.provider_environment AS "providerEnvironment",
    t.provider_transaction_id AS "providerTransactionId",
    t.quantity,
    t.unit_price_cents AS "unitPriceCents",
    t.base_fee_cents AS "baseFeeCents",
    t.delivery_fee_cents AS "deliveryFeeCents",
    (t.quantity::bigint * t.unit_price_cents + t.base_fee_cents + t.delivery_fee_cents) AS "totalCents",
    t.currency,
    t.created_at AS "transactionCreatedAt",
    t.submission_started_at AS "submissionStartedAt",
    t.finalized_at AS "finalizedAt",
    c.id AS "checkoutId",
    c.status AS "checkoutStatus",
    p.id AS "productId",
    p.sku,
    p.stock AS "physicalStock",
    availability.active_held AS "activeHeld",
    GREATEST(p.stock - availability.active_held, 0) AS available,
    r.id AS "reservationId",
    r.status AS "reservationStatus",
    r.expires_at AS "reservationExpiresAt",
    d.id AS "deliveryId",
    d.status AS "deliveryStatus"
  FROM transactions t
  JOIN checkouts c ON c.id = t.checkout_id
  JOIN products p ON p.id = t.product_id
  JOIN inventory_reservations r ON r.transaction_id = t.id
  LEFT JOIN deliveries d ON d.transaction_id = t.id
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(other.quantity), 0)::integer AS active_held
    FROM inventory_reservations other
    JOIN transactions other_t ON other_t.id = other.transaction_id
    WHERE other.product_id = p.id
      AND other.status = 'HELD'
      AND (other_t.dispatch_status <> 'NOT_SENT' OR other.expires_at > CURRENT_TIMESTAMP)
  ) availability
  WHERE t.id = $1
`;

const createInspectionSource = () =>
  new DataSource(createDatabaseOptions(loadDatabaseEnvironment()));

export async function inspectTransaction(
  id: string,
  sourceFactory: () => DataSource = createInspectionSource,
) {
  const source = sourceFactory();
  let runner: ReturnType<DataSource['createQueryRunner']> | null = null;
  try {
    await source.initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SET TRANSACTION READ ONLY');
    const rows = (await runner.query(query, [id])) as InspectionRow[];
    await runner.commitTransaction();
    return rows[0] ? sanitizeInspection(rows[0]) : null;
  } finally {
    if (runner) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    if (source.isInitialized) await source.destroy();
  }
}

type Inspection = typeof inspectTransaction;

export async function runInspectionCli(
  argument: unknown,
  inspect: Inspection = inspectTransaction,
  stdout: (value: string) => void = (value) => process.stdout.write(value),
  stderr: (value: string) => void = (value) => process.stderr.write(value),
): Promise<number> {
  try {
    const id = parseTransactionId(argument);
    const result = await inspect(id);
    if (!result) {
      stderr('Transaction not found.\n');
      return 2;
    }
    stdout(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error: unknown) {
    stderr(
      error instanceof Error && error.message === 'INVALID_TRANSACTION_ID'
        ? 'A valid transaction UUID is required.\n'
        : 'Transaction inspection failed. Check database availability and environment configuration.\n',
    );
    return 1;
  }
}

if (require.main === module)
  void runInspectionCli(process.argv[2]).then((code) => {
    process.exitCode = code;
  });
