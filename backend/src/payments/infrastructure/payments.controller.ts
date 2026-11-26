import { AttemptResponseDto } from '../../checkout/infrastructure/http/transactions.controller';
import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseFilters,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiProperty, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  IsString,
  MaxLength,
  Matches,
  IsInt,
  Equals,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CheckoutGuard,
  failure,
} from '../../checkout/infrastructure/http/session-security';
import type { CheckoutRequest } from '../../checkout/infrastructure/http/session-security';
import { CheckoutInputFilter } from '../../checkout/infrastructure/http/checkouts.controller';
import {
  GetPaymentConfig,
  StartPayment,
  SyncPayment,
} from '../application/payment-cases';
import type { PaymentError } from '../domain/payment';
import type { AttemptView } from '../../checkout/domain/transaction';
import type { Result } from 'neverthrow';
export class AcceptanceDto {
  @ApiProperty({ maxLength: 8192 })
  @IsString()
  @MaxLength(8192)
  @Matches(/\S/)
  acceptanceToken!: string;
  @ApiProperty({ maxLength: 8192 })
  @IsString()
  @MaxLength(8192)
  @Matches(/\S/)
  personalAuthToken!: string;
  @ApiProperty({ enum: [true] }) @Equals(true) policyAccepted!: boolean;
  @ApiProperty({ enum: [true] }) @Equals(true) personalDataAccepted!: boolean;
}
export class PayDto {
  @ApiProperty({ maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  @Matches(/\S/)
  cardToken!: string;
  @ApiProperty({ type: 'integer', enum: [1] })
  @IsInt()
  @Equals(1)
  installments!: number;
  @ApiProperty({ type: AcceptanceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AcceptanceDto)
  acceptance!: AcceptanceDto;
}
class PublicAcceptanceDto {
  @ApiProperty() acceptanceToken!: string;
  @ApiProperty() personalAuthToken!: string;
  @ApiProperty({ format: 'uri' }) policyUrl!: string;
  @ApiProperty({ format: 'uri' }) personalDataUrl!: string;
}
class PublicConfigDto {
  @ApiProperty({ enum: ['UAT_SANDBOX'] }) environment!: string;
  @ApiProperty() publicKey!: string;
  @ApiProperty({ format: 'uri' }) tokenizationUrl!: string;
  @ApiProperty({ type: 'integer', enum: [1] }) installments!: number;
  @ApiProperty({ type: PublicAcceptanceDto }) acceptance!: PublicAcceptanceDto;
}
class ConfigResponseDto {
  @ApiProperty({ type: PublicConfigDto }) data!: PublicConfigDto;
}
function paymentFailure(error: PaymentError) {
  if (error.kind === 'GATEWAY_UNAVAILABLE')
    return new HttpException(
      {
        error: {
          code: error.kind,
          message: 'Payment configuration or provider unavailable.',
        },
      },
      503,
    );
  if (error.kind === 'INVALID_ACCEPTANCE')
    return new HttpException(
      {
        error: {
          code: error.kind,
          message: 'Acceptance does not match current contracts.',
        },
      },
      422,
    );
  return failure(error);
}
function result<T>(r: Result<T, PaymentError>) {
  return r.match(
    (data) => ({ data }),
    (error) => {
      throw paymentFailure(error);
    },
  );
}
function status(view: AttemptView, res: Response) {
  const pending =
    view.status === 'PENDING' && view.dispatchStatus !== 'NOT_SENT';
  res.status(pending ? 202 : 200);
  if (pending) res.setHeader('Retry-After', '5');
  return { data: view };
}
@ApiTags('payments')
@ApiResponse({
  status: 400,
  description: 'Unsupported fields or input format.',
})
@ApiResponse({ status: 401, description: 'Missing or expired guest session.' })
@ApiResponse({
  status: 503,
  description:
    'Sanitized provider or persistence error; never authorizes another charge.',
})
@UseGuards(CheckoutGuard)
@UseFilters(CheckoutInputFilter)
@Controller('api/v1')
export class PaymentsController {
  constructor(
    private readonly config: GetPaymentConfig,
    private readonly start: StartPayment,
    private readonly syncCase: SyncPayment,
  ) {}
  @Get('payments/config')
  @ApiResponse({
    status: 200,
    type: ConfigResponseDto,
    description:
      'data: environment=UAT_SANDBOX, publicKey, tokenizationUrl, installments=1, acceptance with acceptanceToken, personalAuthToken, policyUrl and personalDataUrl. No private credentials.',
  })
  async configuration() {
    return result(await this.config.execute());
  }
  @Post('transactions/:id/pay')
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({
    status: 200,
    type: AttemptResponseDto,
    description:
      'data: local attempt view after verified final result or replay.',
  })
  @ApiResponse({
    status: 202,
    type: AttemptResponseDto,
    description:
      'data: local pending/uncertain attempt; Retry-After 5; no resend.',
  })
  @ApiResponse({ status: 403, description: 'Invalid Origin/CSRF.' })
  @ApiResponse({ status: 404, description: 'Missing or foreign attempt.' })
  @ApiResponse({
    status: 409,
    description:
      'PAYLOAD_CONFLICT, RESERVATION_EXPIRED, OBSERVATION_CONFLICT or CHECKOUT_LOCKED.',
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid acceptance or payment input.',
  })
  async pay(
    @Req() req: CheckoutRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PayDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.start.execute(req.checkoutSession.id, id, body);
    if (r.isErr()) throw paymentFailure(r.error);
    return status(r.value, res);
  }
  @Post('transactions/:id/sync')
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({
    status: 200,
    type: AttemptResponseDto,
    description: 'data: final or NOT_SENT local attempt, no charge initiated.',
  })
  @ApiResponse({
    status: 202,
    type: AttemptResponseDto,
    description: 'data: pending/uncertain local attempt; Retry-After 5.',
  })
  @ApiResponse({ status: 403, description: 'Invalid Origin/CSRF.' })
  @ApiResponse({ status: 404, description: 'Missing or foreign attempt.' })
  @ApiResponse({
    status: 409,
    description: 'Contradictory observation; retained for review.',
  })
  async sync(
    @Req() req: CheckoutRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (
      Number(req.headers['content-length'] ?? 0) > 0 ||
      req.headers['transfer-encoding']
    )
      throw new BadRequestException();
    const r = await this.syncCase.execute(req.checkoutSession.id, id);
    if (r.isErr()) throw paymentFailure(r.error);
    return status(r.value, res);
  }
}
