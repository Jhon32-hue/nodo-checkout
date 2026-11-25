import { Check, Column, Entity, Unique } from 'typeorm';
import { PersistedEntity } from '../../../infrastructure/database/persisted.entity';
import type { ProductCategory } from '../../domain/product-category';

@Entity('products')
@Unique('uq_products_sku', ['sku'])
@Check(
  'ck_products_category',
  "category IS NULL OR category IN ('audio', 'computacion', 'accesorios', 'almacenamiento', 'hogar-inteligente')",
)
@Check(
  'ck_products_text',
  "btrim(sku) <> '' AND btrim(name) <> '' AND btrim(description) <> '' AND image_url LIKE 'https://%'",
)
@Check(
  'ck_products_money',
  "unit_price_cents BETWEEN 1 AND 2000000000 AND currency = 'COP'",
)
@Check('ck_products_stock', 'stock BETWEEN 0 AND 1000000')
export class ProductOrmEntity extends PersistedEntity {
  @Column({ name: 'sku', type: 'varchar', length: 64 })
  sku!: string;

  @Column({ name: 'category', type: 'varchar', length: 32, nullable: true })
  category!: ProductCategory | null;

  @Column({ name: 'name', type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'description', type: 'text' })
  description!: string;

  @Column({ name: 'image_url', type: 'varchar', length: 2048 })
  imageUrl!: string;

  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents!: number;

  @Column({ name: 'currency', type: 'char', length: 3, default: 'COP' })
  currency!: string;

  @Column({ name: 'stock', type: 'integer' })
  stock!: number;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;
}
