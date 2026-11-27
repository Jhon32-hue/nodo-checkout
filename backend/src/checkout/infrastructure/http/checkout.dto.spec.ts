import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  BuyerDto,
  CreateCheckoutDto,
  DeliveryDto,
  PatchCheckoutDto,
} from './checkout.dto';
import { TransactionsController } from './transactions.controller';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validate = async (
  body: unknown,
  metatype: Type<unknown>,
): Promise<unknown> =>
  (await pipe.transform(body, { type: 'body', metatype })) as unknown;

const buyer = () => ({
  fullName: '  Ada Lovelace  ',
  email: '  ada@example.test  ',
  phone: '  +573001234567  ',
});

const delivery = () => ({
  recipientName: '  Ada Lovelace  ',
  phone: '  +573001234567  ',
  addressLine1: '  Calle 1 # 2-3  ',
  addressLine2: '  Apto 4  ',
  city: '  Bogotá  ',
  region: '  Bogotá D.C.  ',
  country: '  CO  ',
  postalCode: '  110111  ',
});

describe('checkout HTTP DTO validation', () => {
  it('accepts a UUID v4 and quantity boundaries', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    await expect(
      validate({ productId, quantity: 1 }, CreateCheckoutDto),
    ).resolves.toEqual(expect.objectContaining({ productId, quantity: 1 }));
    await expect(
      validate({ productId, quantity: 99 }, CreateCheckoutDto),
    ).resolves.toBeInstanceOf(CreateCheckoutDto);
  });

  it.each([
    {},
    { productId: 'not-a-uuid', quantity: 1 },
    { productId: '11111111-1111-4111-8111-111111111111', quantity: 0 },
    { productId: '11111111-1111-4111-8111-111111111111', quantity: 100 },
    { productId: '11111111-1111-4111-8111-111111111111', quantity: 1.5 },
    {
      productId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      extra: true,
    },
  ])('rejects invalid checkout creation input %#', async (body) => {
    await expect(validate(body, CreateCheckoutDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validates and trims buyer and delivery fields recursively', async () => {
    const actual = await validate(
      { quantity: 2, buyer: buyer(), delivery: delivery() },
      PatchCheckoutDto,
    );
    expect(actual).toEqual({
      quantity: 2,
      buyer: {
        fullName: 'Ada Lovelace',
        email: 'ada@example.test',
        phone: '+573001234567',
      },
      delivery: {
        recipientName: 'Ada Lovelace',
        phone: '+573001234567',
        addressLine1: 'Calle 1 # 2-3',
        addressLine2: 'Apto 4',
        city: 'Bogotá',
        region: 'Bogotá D.C.',
        country: 'CO',
        postalCode: '110111',
      },
    });
    expect((actual as PatchCheckoutDto).buyer).toBeInstanceOf(BuyerDto);
    expect((actual as PatchCheckoutDto).delivery).toBeInstanceOf(DeliveryDto);
  });

  it.each([
    { buyer: { ...buyer(), fullName: '' } },
    { buyer: { ...buyer(), email: 'invalid' } },
    { buyer: { ...buyer(), phone: '3001234567' } },
    { delivery: { ...delivery(), addressLine1: '' } },
    { delivery: { ...delivery(), country: 'US' } },
    { delivery: { ...delivery(), phone: '+0' } },
    { delivery: { ...delivery(), privateField: 'forbidden' } },
  ])('rejects invalid nested personal or delivery data %#', async (body) => {
    await expect(validate(body, PatchCheckoutDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validates the transaction request DTO used by the controller', async () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      TransactionsController.prototype,
      'create',
    ) as Type<unknown>[];
    const transactionDto = parameterTypes[2];
    const valid = {
      checkoutId: '11111111-1111-4111-8111-111111111111',
      acceptedSummary: {
        quantity: 2,
        unitPriceCents: 10000,
        baseFeeCents: 50000,
        deliveryFeeCents: 100000,
        currency: 'COP',
      },
    };

    await expect(validate(valid, transactionDto)).resolves.toEqual(valid);
    for (const invalid of [
      { ...valid, checkoutId: 'invalid' },
      { ...valid, acceptedSummary: { ...valid.acceptedSummary, quantity: 0 } },
      {
        ...valid,
        acceptedSummary: { ...valid.acceptedSummary, currency: 'USD' },
      },
      { ...valid, acceptedSummary: { ...valid.acceptedSummary, extra: 1 } },
    ])
      await expect(validate(invalid, transactionDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });
});
