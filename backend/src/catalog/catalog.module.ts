import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetProduct } from './application/get-product';
import { ListProducts } from './application/list-products';
import { PRODUCT_REPOSITORY } from './application/product-repository';
import type { ProductRepository } from './application/product-repository';
import { ProductOrmEntity } from './infrastructure/typeorm/product.entity';
import { TypeOrmProductRepository } from './infrastructure/typeorm/typeorm-product.repository';
import { ProductsController } from './infrastructure/http/products.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProductOrmEntity])],
  controllers: [ProductsController],
  providers: [
    TypeOrmProductRepository,
    { provide: PRODUCT_REPOSITORY, useExisting: TypeOrmProductRepository },
    {
      provide: ListProducts,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (repository: ProductRepository) =>
        new ListProducts(repository),
    },
    {
      provide: GetProduct,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (repository: ProductRepository) => new GetProduct(repository),
    },
  ],
})
export class CatalogModule {}
