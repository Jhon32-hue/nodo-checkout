import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetProduct } from '../../application/get-product';
import { ListProducts } from '../../application/list-products';
import {
  CatalogErrorEnvelopeDto,
  ProductEnvelopeDto,
  ProductListEnvelopeDto,
} from './product.dto';

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: {
      code: 'CATALOG_UNAVAILABLE',
      message: 'No fue posible consultar el catálogo.',
    },
  });
}

function rejectUnsupportedQuery(query: Record<string, unknown>): void {
  if (Object.keys(query).length > 0) {
    throw new BadRequestException({
      error: {
        code: 'INVALID_QUERY_PARAMS',
        message: 'El catálogo no admite parámetros de consulta.',
      },
    });
  }
}

@ApiTags('products')
@Controller('api/v1/products')
export class ProductsController {
  constructor(
    private readonly listProducts: ListProducts,
    private readonly getProduct: GetProduct,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Listar el catálogo activo, incluidos productos agotados',
  })
  @ApiOkResponse({
    type: ProductListEnvelopeDto,
    description:
      'Catálogo activo completo, con precios en centavos COP y unidades disponibles.',
  })
  @ApiBadRequestResponse({
    type: CatalogErrorEnvelopeDto,
    description: 'No se admiten limit, cursor ni filtros.',
    example: {
      error: {
        code: 'INVALID_QUERY_PARAMS',
        message: 'El catálogo no admite parámetros de consulta.',
      },
    },
  })
  @ApiServiceUnavailableResponse({
    type: CatalogErrorEnvelopeDto,
    description: 'Catálogo temporalmente no disponible.',
    example: {
      error: {
        code: 'CATALOG_UNAVAILABLE',
        message: 'No fue posible consultar el catálogo.',
      },
    },
  })
  async list(@Query() query: Record<string, unknown>) {
    rejectUnsupportedQuery(query);
    const result = await this.listProducts.execute();
    return result.match(
      (data) => ({ data }),
      () => {
        throw unavailable();
      },
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Consultar producto y unidades disponibles' })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
    description: 'UUID v4 del producto.',
  })
  @ApiOkResponse({
    type: ProductEnvelopeDto,
    description:
      'Producto activo con su precio en centavos COP y disponibilidad, incluso si está agotado.',
  })
  @ApiBadRequestResponse({
    type: CatalogErrorEnvelopeDto,
    description: 'UUID v4 inválido o parámetros de consulta no admitidos.',
    examples: {
      invalidId: {
        summary: 'Identificador inválido',
        value: {
          error: {
            code: 'INVALID_PRODUCT_ID',
            message: 'El identificador debe ser un UUID v4 válido.',
          },
        },
      },
      unsupportedQuery: {
        summary: 'Query no admitida',
        value: {
          error: {
            code: 'INVALID_QUERY_PARAMS',
            message: 'El catálogo no admite parámetros de consulta.',
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({
    type: CatalogErrorEnvelopeDto,
    description: 'PRODUCT_NOT_FOUND: producto inexistente o inactivo.',
    example: {
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado.' },
    },
  })
  @ApiServiceUnavailableResponse({
    type: CatalogErrorEnvelopeDto,
    description: 'Catálogo temporalmente no disponible.',
    example: {
      error: {
        code: 'CATALOG_UNAVAILABLE',
        message: 'No fue posible consultar el catálogo.',
      },
    },
  })
  async get(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
        exceptionFactory: () =>
          new BadRequestException({
            error: {
              code: 'INVALID_PRODUCT_ID',
              message: 'El identificador debe ser un UUID v4 válido.',
            },
          }),
      }),
    )
    id: string,
    @Query() query: Record<string, unknown>,
  ) {
    rejectUnsupportedQuery(query);
    const result = await this.getProduct.execute(id);
    return result.match(
      (data) => ({ data }),
      (error) => {
        switch (error.kind) {
          case 'ProductNotFound':
            throw new NotFoundException({
              error: {
                code: 'PRODUCT_NOT_FOUND',
                message: 'Producto no encontrado.',
              },
            });
          case 'CatalogUnavailable':
            throw unavailable();
        }
      },
    );
  }
}
