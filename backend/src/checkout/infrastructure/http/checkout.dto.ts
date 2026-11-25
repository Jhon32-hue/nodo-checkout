import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsInt,
  Min,
  Max,
  IsString,
  Length,
  IsEmail,
  Matches,
  Equals,
  IsOptional,
  ValidateIf,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
const trim = (params: TransformFnParams): unknown => {
  const value: unknown = params.value;
  return typeof value === 'string' ? value.trim() : value;
};
export class BuyerDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  fullName!: string;
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(trim)
  @IsEmail()
  @Length(3, 254)
  email!: string;
  @ApiProperty({ maxLength: 16, pattern: '^\\+[1-9]\\d{1,14}$' })
  @Transform(trim)
  @IsString()
  @Length(2, 16)
  @Matches(/^\+[1-9]\d{1,14}$/)
  phone!: string;
}
export class DeliveryDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  recipientName!: string;
  @ApiProperty({ maxLength: 16, pattern: '^\\+[1-9]\\d{1,14}$' })
  @Transform(trim)
  @IsString()
  @Length(2, 16)
  @Matches(/^\+[1-9]\d{1,14}$/)
  phone!: string;
  @ApiProperty({ minLength: 3, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  addressLine1!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  addressLine2?: string | null;
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  city!: string;
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  region!: string;
  @ApiProperty({ enum: ['CO'] })
  @Transform(trim)
  @Equals('CO')
  country!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 12,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 12)
  postalCode?: string | null;
}
export class CreateCheckoutDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') productId!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}
export class PatchCheckoutDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 99 })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;
  @ApiPropertyOptional({ type: BuyerDto })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer?: BuyerDto;
  @ApiPropertyOptional({ type: DeliveryDto })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryDto)
  delivery?: DeliveryDto;
}
