import { ApiProperty } from '@nestjs/swagger';
import { PRODUCT_CATEGORIES } from '../../domain/product-category';
import type { ProductCategory } from '../../domain/product-category';

export class ProductDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  id!: string;
  @ApiProperty({ example: 'AUD-001', maxLength: 64 })
  sku!: string;
  @ApiProperty({
    type: 'string',
    enum: [...PRODUCT_CATEGORIES, null],
    nullable: true,
    required: true,
    example: 'audio',
    description: 'Categoría; null solo para registros ajenos sin clasificar.',
  })
  category!: ProductCategory | null;
  @ApiProperty({ example: 'Auriculares inalámbricos Nova', maxLength: 120 })
  name!: string;
  @ApiProperty({
    example:
      'Auriculares Bluetooth con micrófono integrado, controles táctiles y estuche de carga USB-C. Diseño compacto para llamadas, música y uso diario. Incluyen cable de carga y almohadillas.',
  })
  description!: string;
  @ApiProperty({
    example: 'https://placehold.co/800x600/png?text=Auriculares',
    maxLength: 2048,
  })
  imageUrl!: string;
  @ApiProperty({
    example: 12990000,
    type: 'integer',
    description: 'Centavos enteros COP: 12990000 centavos = 129900 COP.',
    minimum: 1,
    maximum: 2000000000,
  })
  unitPriceCents!: number;
  @ApiProperty({ enum: ['COP'], example: 'COP' })
  currency!: string;
  @ApiProperty({
    example: 10,
    type: 'integer',
    minimum: 0,
    description:
      'Stock menos reservas comprometidas. Cero sigue siendo consultable.',
  })
  available!: number;
}

export class ProductListDto {
  @ApiProperty({ type: [ProductDto] })
  items!: ProductDto[];
}
export class ProductEnvelopeDto {
  @ApiProperty({ type: ProductDto })
  data!: ProductDto;
}
export class ProductListEnvelopeDto {
  @ApiProperty({ type: ProductListDto })
  data!: ProductListDto;
}
export class CatalogErrorDto {
  @ApiProperty({
    enum: [
      'INVALID_PRODUCT_ID',
      'INVALID_QUERY_PARAMS',
      'PRODUCT_NOT_FOUND',
      'CATALOG_UNAVAILABLE',
    ],
  })
  code!: string;
  @ApiProperty({ example: 'Producto no encontrado.' })
  message!: string;
}
export class CatalogErrorEnvelopeDto {
  @ApiProperty({ type: CatalogErrorDto })
  error!: CatalogErrorDto;
}
