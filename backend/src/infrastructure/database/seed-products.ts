import type { DataSource } from 'typeorm';
import { ProductOrmEntity } from '../../catalog/infrastructure/typeorm/product.entity';

export const demoProducts = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'DEMO-HEADPHONES',
    name: 'Auriculares de ejemplo',
    description: 'Producto ficticio para checkout sandbox.',
    imageUrl: 'https://placehold.co/800x600/png?text=Auriculares',
    unitPriceCents: 250000,
    currency: 'COP',
    stock: 10,
    active: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'DEMO-SPEAKER',
    name: 'Parlante de ejemplo',
    description: 'Segundo producto ficticio para checkout sandbox.',
    imageUrl: 'https://placehold.co/800x600/png?text=Parlante',
    unitPriceCents: 500000,
    currency: 'COP',
    stock: 5,
    active: true,
  },
];

export async function seedProducts(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    // Ignore both SKU and ID conflicts. Never overwrite prices or consumed stock.
    await manager
      .createQueryBuilder()
      .insert()
      .into(ProductOrmEntity)
      .values(demoProducts)
      .orIgnore()
      .execute();
  });
}
