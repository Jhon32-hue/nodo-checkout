import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  UseFilters,
  Catch,
  BadRequestException,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiParam,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Result } from 'neverthrow';
import {
  EnsureCheckoutSession,
  CreateCheckout,
  GetCheckout,
  UpdateCheckout,
  GetSummary,
} from '../../application/checkout-cases';
import type { CheckoutError } from '../../domain/checkout';
import {
  CheckoutGuard,
  CryptoSessionTokens,
  SessionBootstrap,
  failure,
} from './session-security';
import type { CheckoutRequest } from './session-security';
import {
  CreateCheckoutDto,
  PatchCheckoutDto,
  BuyerDto,
  DeliveryDto,
} from './checkout.dto';
import type { SchemaObject } from '@nestjs/swagger';
const viewSchema: SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: [
        'id',
        'productId',
        'quantity',
        'status',
        'buyer',
        'delivery',
        'activeTransactionId',
        'latestTransactionId',
        'deliveryId',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        productId: { type: 'string', format: 'uuid' },
        quantity: { type: 'integer', minimum: 1, maximum: 99 },
        status: { type: 'string', enum: ['DRAFT', 'PAYMENT_PENDING', 'PAID'] },
        buyer: {
          oneOf: [
            { $ref: getSchemaPath(BuyerDto) },
            { type: 'object', nullable: true, enum: [null] },
          ],
        },
        delivery: {
          oneOf: [
            { $ref: getSchemaPath(DeliveryDto) },
            { type: 'object', nullable: true, enum: [null] },
          ],
        },
        activeTransactionId: { type: 'string', format: 'uuid', nullable: true },
        latestTransactionId: { type: 'string', format: 'uuid', nullable: true },
        deliveryId: { type: 'string', format: 'uuid', nullable: true },
      },
    },
  },
};
const invalid = () =>
  new BadRequestException({
    error: { code: 'INVALID_REQUEST', message: 'Solicitud invÃ¡lida.' },
  });
function uuid(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw invalid();
  return id;
}
function respond<T>(result: Result<T, CheckoutError>) {
  return result.match(
    (data) => ({ data }),
    (error) => {
      throw failure(error);
    },
  );
}
@Catch(BadRequestException)
export class CheckoutInputFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json(invalid().getResponse());
  }
}
@ApiTags('checkout')
@ApiExtraModels(BuyerDto, DeliveryDto)
@ApiHeader({
  name: 'Cookie',
  description: 'checkout_session recibida al crear sesiÃ³n',
  required: false,
})
@ApiHeader({
  name: 'Origin',
  description: 'Origen permitido, obligatorio para escrituras',
  required: false,
})
@ApiHeader({
  name: 'X-CSRF-Token',
  description: 'Obligatorio en POST/PATCH de compra',
  required: false,
})
@ApiResponse({ status: 400, description: 'Formato o campos no admitidos.' })
@ApiResponse({ status: 401, description: 'SesiÃ³n ausente o vencida.' })
@ApiResponse({ status: 403, description: 'Origin o CSRF invÃ¡lidos.' })
@ApiResponse({
  status: 404,
  description: 'Recurso inexistente o de otra sesiÃ³n.',
})
@ApiResponse({ status: 409, description: 'Compra bloqueada para ediciÃ³n.' })
@ApiResponse({
  status: 422,
  description: 'Reglas de negocio o compra incompleta.',
})
@ApiResponse({
  status: 503,
  description: 'Persistencia temporalmente no disponible.',
})
@UseFilters(CheckoutInputFilter)
@UseGuards(CheckoutGuard)
@Controller('api/v1')
export class CheckoutsController {
  constructor(
    private readonly ensure: EnsureCheckoutSession,
    private readonly create: CreateCheckout,
    private readonly getCase: GetCheckout,
    private readonly update: UpdateCheckout,
    private readonly summary: GetSummary,
    private readonly tokens: CryptoSessionTokens,
  ) {}
  @Post('checkout-sessions')
  @SessionBootstrap()
  @ApiOperation({
    summary: 'Crear o recuperar sesiÃ³n guest sin renovar vencimiento',
  })
  @ApiResponse({
    status: 201,
    description:
      'SesiÃ³n nueva, data.csrfToken y data.expiresAt; cookie HttpOnly.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['csrfToken', 'expiresAt'],
          properties: {
            csrfToken: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'SesiÃ³n existente, mismo vencimiento.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['csrfToken', 'expiresAt'],
          properties: {
            csrfToken: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  async session(
    @Req() req: CheckoutRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (
      Number(req.headers['content-length'] ?? 0) > 0 ||
      req.headers['transfer-encoding']
    )
      throw invalid();
    const result = await this.ensure.execute(this.tokens.cookie(req));
    if (result.isErr()) throw failure(result.error);
    const value = result.value;
    res.status(value.created ? 201 : 200);
    if (value.created)
      res.cookie('checkout_session', value.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.headers.origin?.startsWith('https://') === true,
        path: '/',
        expires: value.session.expiresAt,
      });
    return {
      data: {
        csrfToken: value.csrfToken,
        expiresAt: value.session.expiresAt.toISOString(),
      },
    };
  }
  @Post('checkouts')
  @ApiOperation({
    summary: 'Seleccionar producto/cantidad; crear DRAFT sin reservar',
  })
  @ApiResponse({
    status: 201,
    description:
      'Compra creada con buyer/delivery vacÃ­os y referencias de transacciones null.',
    schema: viewSchema,
  })
  async createDraft(
    @Req() req: CheckoutRequest,
    @Body() body: CreateCheckoutDto,
  ) {
    return respond(
      await this.create.execute(
        req.checkoutSession.id,
        body.productId,
        body.quantity,
      ),
    );
  }
  @Get('checkouts/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Recuperar compra propia desde PostgreSQL' })
  @ApiResponse({
    status: 200,
    description:
      'data: id, productId, quantity, status, buyer, delivery, activeTransactionId, latestTransactionId y deliveryId.',
    schema: viewSchema,
  })
  async get(@Req() req: CheckoutRequest, @Param('id') id: string) {
    return respond(
      await this.getCase.execute(req.checkoutSession.id, uuid(id)),
    );
  }
  @Patch('checkouts/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Guardar campos completos del borrador atÃ³micamente',
  })
  @ApiResponse({
    status: 200,
    description:
      'Vista de compra actualizada, sin crear entrega ni reservar stock.',
    schema: viewSchema,
  })
  async patch(
    @Req() req: CheckoutRequest,
    @Param('id') id: string,
    @Body() body: PatchCheckoutDto,
  ) {
    if (Object.values(body).every((value) => value === undefined))
      throw invalid();
    return respond(
      await this.update.execute(req.checkoutSession.id, uuid(id), body),
    );
  }
  @Get('checkouts/:id/summary')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Resumen calculado en centavos COP; histÃ³rico si hay intento activo/aprobado',
  })
  @ApiResponse({
    status: 200,
    description:
      'data: quantity, unitPriceCents, subtotalCents, baseFeeCents, deliveryFeeCents, totalCents y currency.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: [
            'quantity',
            'unitPriceCents',
            'subtotalCents',
            'baseFeeCents',
            'deliveryFeeCents',
            'totalCents',
            'currency',
          ],
          properties: {
            quantity: { type: 'integer' },
            unitPriceCents: { type: 'integer' },
            subtotalCents: { type: 'integer' },
            baseFeeCents: { type: 'integer' },
            deliveryFeeCents: { type: 'integer' },
            totalCents: { type: 'integer' },
            currency: { type: 'string', enum: ['COP'] },
          },
        },
      },
      example: {
        data: {
          quantity: 2,
          unitPriceCents: 12990000,
          subtotalCents: 25980000,
          baseFeeCents: 50000,
          deliveryFeeCents: 100000,
          totalCents: 26130000,
          currency: 'COP',
        },
      },
    },
  })
  async getSummary(@Req() req: CheckoutRequest, @Param('id') id: string) {
    return respond(
      await this.summary.execute(req.checkoutSession.id, uuid(id)),
    );
  }
}
