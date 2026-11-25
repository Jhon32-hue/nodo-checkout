import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { err, ok, Result, ResultAsync } from 'neverthrow';
import { Repository } from 'typeorm';
import type {
  ProductRepository,
  CatalogUnavailable,
} from '../../application/product-repository';
import type { Product } from '../../domain/product';
import { Money } from '../../../shared/domain/money';
import { ProductOrmEntity } from './product.entity';
import { InventoryReservationOrmEntity } from './inventory-reservation.entity';
import { isProductCategory } from '../../domain/product-category';

@Injectable()
export class TypeOrmProductRepository implements ProductRepository {
  constructor(
    @InjectRepository(ProductOrmEntity)
    private readonly repository: Repository<ProductOrmEntity>,
  ) {}

  list(): ResultAsync<readonly Product[], CatalogUnavailable> {
    return this.read();
  }

  findById(id: string): ResultAsync<Product | null, CatalogUnavailable> {
    return this.read(id).map((products) => products[0] ?? null);
  }

  private read(id?: string): ResultAsync<Product[], CatalogUnavailable> {
    return ResultAsync.fromPromise(
      this.readRows(id),
      (): CatalogUnavailable => ({ kind: 'CatalogUnavailable' }),
    ).andThen(({ entities, raw }) =>
      Result.combine(
        entities.map((entity, index) => {
          const reserved = raw[index]?.reserved;
          const held =
            typeof reserved === 'string' && /^\d+$/.test(reserved)
              ? Number(reserved)
              : NaN;
          const available = entity.stock - held;
          return Money.fromCents(entity.unitPriceCents, entity.currency)
            .mapErr((): CatalogUnavailable => ({ kind: 'CatalogUnavailable' }))
            .andThen((unitPrice): Result<Product, CatalogUnavailable> => {
              if (
                unitPrice.cents === 0 ||
                !Number.isSafeInteger(held) ||
                !Number.isSafeInteger(available) ||
                available < 0 ||
                (entity.category !== null &&
                  !isProductCategory(entity.category))
              ) {
                return err({ kind: 'CatalogUnavailable' });
              }
              return ok({
                id: entity.id,
                sku: entity.sku,
                category: entity.category,
                name: entity.name,
                description: entity.description,
                imageUrl: entity.imageUrl,
                unitPrice,
                available,
              });
            });
        }),
      ),
    );
  }

  private async readRows(id?: string) {
    const query = this.repository
      .createQueryBuilder('product')
      .addSelect(
        (subquery) =>
          subquery
            .select('COALESCE(SUM(reservation.quantity), 0)')
            .from(InventoryReservationOrmEntity, 'reservation')
            .innerJoin('reservation.transaction', 'attempt')
            .where('reservation.product_id = product.id')
            .andWhere('reservation.status = :held', { held: 'HELD' })
            .andWhere(
              '(attempt.dispatch_status <> :notSent OR reservation.expires_at > CURRENT_TIMESTAMP)',
              { notSent: 'NOT_SENT' },
            ),
        'reserved',
      )
      .where('product.active = :active', { active: true })
      .orderBy('product.id', 'ASC');
    if (id !== undefined) query.andWhere('product.id = :id', { id });
    // One row per product. PostgreSQL SUM(smallint) returns an int8 string.
    return query.getRawAndEntities<{ reserved: string }>();
  }
}
