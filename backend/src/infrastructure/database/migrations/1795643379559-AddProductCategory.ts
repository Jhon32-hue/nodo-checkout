import type { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen data migration: never import the evolving seed here.
const originals = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'DEMO-HEADPHONES',
    name: 'Auriculares de ejemplo',
    description: 'Producto ficticio para checkout sandbox.',
    image_url: 'https://placehold.co/800x600/png?text=Auriculares',
    unit_price_cents: 250000,
    currency: 'COP',
    active: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'DEMO-SPEAKER',
    name: 'Parlante de ejemplo',
    description: 'Segundo producto ficticio para checkout sandbox.',
    image_url: 'https://placehold.co/800x600/png?text=Parlante',
    unit_price_cents: 500000,
    currency: 'COP',
    active: true,
  },
];
const replacements = [
  {
    sku: 'AUD-001',
    name: 'Auriculares inalámbricos Nova',
    description:
      'Auriculares Bluetooth con micrófono integrado, controles táctiles y estuche de carga USB-C. Diseño compacto para llamadas, música y uso diario. Incluyen cable de carga y almohadillas.',
    image_url: 'https://placehold.co/800x600/png?text=Auriculares',
    unit_price_cents: 12990000,
    currency: 'COP',
    active: true,
  },
  {
    sku: 'AUD-002',
    name: 'Parlante portátil Pulse',
    description:
      'Parlante Bluetooth portátil de 20 W con conexión auxiliar, controles físicos y carga USB-C. Su formato compacto permite moverlo entre espacios del hogar. Incluye cable de carga.',
    image_url: 'https://placehold.co/800x600/png?text=Parlante',
    unit_price_cents: 17990000,
    currency: 'COP',
    active: true,
  },
];

export class AddProductCategory1795643379559 implements MigrationInterface {
  name = 'AddProductCategory1795643379559';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "products" ADD "category" character varying(32)',
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "ck_products_category" CHECK (category IS NULL OR category IN ('audio', 'computacion', 'accesorios', 'almacenamiento', 'hogar-inteligente'))`,
    );
    for (const [index, original] of originals.entries()) {
      const replacement = replacements[index];
      const rows = await queryRunner.manager.query<Record<string, unknown>[]>(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE',
        [original.id],
      );
      const existing = rows[0];
      if (!existing) continue;
      // Reapplying after down must not overwrite later presentation edits.
      if (existing.sku === replacement.sku) {
        await queryRunner.query(
          'UPDATE products SET category = $1 WHERE id = $2',
          ['audio', original.id],
        );
        continue;
      }
      if (
        !Object.entries(original).every(
          ([field, value]) => existing[field] === value,
        )
      ) {
        throw new Error(
          `CATALOG_TRANSITION_CONFLICT: ${original.id} was customized; no presentation fields were overwritten.`,
        );
      }
      const conflicts = await queryRunner.manager.query<{ id: string }[]>(
        'SELECT id FROM products WHERE sku = $1 AND id <> $2',
        [replacement.sku, original.id],
      );
      if (conflicts.length > 0)
        throw new Error(
          `CATALOG_TRANSITION_CONFLICT: target SKU ${replacement.sku} already exists.`,
        );
      await queryRunner.query(
        `UPDATE products SET sku=$1, name=$2, description=$3, image_url=$4, unit_price_cents=$5, currency=$6, active=$7, category='audio', updated_at=CURRENT_TIMESTAMP WHERE id=$8`,
        [
          replacement.sku,
          replacement.name,
          replacement.description,
          replacement.image_url,
          replacement.unit_price_cents,
          replacement.currency,
          replacement.active,
          original.id,
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "products" DROP CONSTRAINT "ck_products_category"',
    );
    await queryRunner.query('ALTER TABLE "products" DROP COLUMN "category"');
    // Do not revert prices/SKUs: that could overwrite edits made since up.
  }
}
