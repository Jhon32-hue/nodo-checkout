import dataSource from './data-source';
import { seedProducts } from './seed-products';

async function main(): Promise<void> {
  try {
    await dataSource.initialize();
    await seedProducts(dataSource);
    console.log(
      'Product seed completed; existing products were left unchanged.',
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch(() => {
  console.error(
    'Product seed failed. Check configuration and run migrations first.',
  );
  process.exitCode = 1;
});
