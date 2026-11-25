import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Param,
  Req,
  UseGuards,
  UseFilters,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiProperty, ApiTags, ApiHeader, ApiResponse } from '@nestjs/swagger';
import {
  IsUUID,
  IsInt,
  Min,
  Max,
  Equals,
  ValidateNested,
  IsObject,
  isUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateTransaction,
  GetTransaction,
} from '../../application/transaction-cases';
import { CheckoutGuard, failure } from './session-security';
import type { CheckoutRequest } from './session-security';
import { CheckoutInputFilter } from './checkouts.controller';
import type { Result } from 'neverthrow';
import type { CheckoutError } from '../../domain/checkout';
class AcceptedSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2000000000 })
  @IsInt()
  @Min(1)
  @Max(2000000000)
  unitPriceCents!: number;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2000000000 })
  @IsInt()
  @Min(0)
  @Max(2000000000)
  baseFeeCents!: number;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2000000000 })
  @IsInt()
  @Min(0)
  @Max(2000000000)
  deliveryFeeCents!: number;
  @ApiProperty({ enum: ['COP'] }) @Equals('COP') currency!: string;
}
class CreateTransactionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') checkoutId!: string;
  @ApiProperty({ type: AcceptedSummaryDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AcceptedSummaryDto)
  acceptedSummary!: AcceptedSummaryDto;
}
class AttemptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) checkoutId!: string;
  @ApiProperty({
    enum: ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'EXPIRED'],
  })
  status!: string;
  @ApiProperty({
    enum: ['NOT_SENT', 'IN_FLIGHT', 'SUBMITTED', 'UNKNOWN', 'NOT_CREATED'],
  })
  dispatchStatus!: string;
  @ApiProperty({ format: 'date-time' }) reservationExpiresAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) deliveryId!:
    string | null;
}
class AttemptResponseDto {
  @ApiProperty({ type: AttemptDto }) data!: AttemptDto;
}
class SummaryDto extends AcceptedSummaryDto {
  @ApiProperty({ type: 'integer' }) subtotalCents!: number;
  @ApiProperty({ type: 'integer' }) totalCents!: number;
}
class AttemptDetailsDto extends AttemptDto {
  @ApiProperty() reference!: string;
  @ApiProperty({ type: SummaryDto }) summary!: SummaryDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  finalizedAt!: string | null;
  @ApiProperty({ enum: ['HELD', 'RELEASED', 'CONFIRMED'] })
  reservationStatus!: string;
  @ApiProperty() reservationExpired!: boolean;
}
class DetailsResponseDto {
  @ApiProperty({ type: AttemptDetailsDto }) data!: AttemptDetailsDto;
}
function respond<T>(result: Result<T, CheckoutError>) {
  return result.match(
    (data) => ({ data }),
    (error) => {
      throw failure(error);
    },
  );
}
@ApiTags('transactions')
@ApiResponse({ status: 400, description: 'Invalid UUID, fields or types.' })
@ApiResponse({ status: 401, description: 'Missing or expired session.' })
@ApiResponse({
  status: 404,
  description:
    'Missing resource or foreign checkout/attempt; inactive product on creation.',
})
@ApiResponse({ status: 503, description: 'Sanitized persistence failure.' })
@UseGuards(CheckoutGuard)
@UseFilters(CheckoutInputFilter)
@Controller('api/v1/transactions')
export class TransactionsController {
  constructor(
    private readonly createCase: CreateTransaction,
    private readonly getCase: GetTransaction,
  ) {}
  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({
    status: 201,
    type: AttemptResponseDto,
    description:
      'PENDING with HELD reservation, or same attempt on identical replay.',
  })
  @ApiResponse({ status: 403, description: 'Invalid Origin or CSRF.' })
  @ApiResponse({
    status: 409,
    description:
      'IDEMPOTENCY_CONFLICT, CHECKOUT_LOCKED, SUMMARY_CHANGED or INSUFFICIENT_STOCK.',
  })
  @ApiResponse({
    status: 422,
    description: 'Incomplete or invalid business data/amounts.',
  })
  async create(
    @Req() req: CheckoutRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateTransactionDto,
  ) {
    if (!key || !isUUID(key, '4')) throw new BadRequestException();
    return respond(
      await this.createCase.execute(
        req.checkoutSession.id,
        body.checkoutId,
        key,
        body.acceptedSummary,
      ),
    );
  }
  @Get(':id')
  @ApiResponse({
    status: 200,
    type: DetailsResponseDto,
    description:
      'Historical amounts, reference, dates and reservation state; never writes or contacts provider.',
  })
  async get(
    @Req() req: CheckoutRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return respond(await this.getCase.execute(req.checkoutSession.id, id));
  }
}
