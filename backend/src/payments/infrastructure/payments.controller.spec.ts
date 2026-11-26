import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PayDto } from './payments.controller';
const payload = () => ({
  cardToken: ' opaque token ',
  installments: 1,
  acceptance: {
    acceptanceToken: ' policy token ',
    personalAuthToken: ' personal token ',
    policyAccepted: true,
    personalDataAccepted: true,
  },
});
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: PayDto });
describe('HTTP payment input security', () => {
  it('keeps opaque content exactly as received, including meaningful whitespace', async () => {
    const p = payload();
    const actual: unknown = await validate(p);
    expect(actual).toEqual(p);
  });
  it('accepts the documented token size boundaries', async () => {
    const p = payload();
    p.cardToken = 'x'.repeat(1024);
    p.acceptance.acceptanceToken = 'x'.repeat(8192);
    p.acceptance.personalAuthToken = 'x'.repeat(8192);
    await expect(validate(p)).resolves.toBeInstanceOf(PayDto);
  });
  it.each(['pan', 'cvc', 'amount', 'reference', 'status', 'providerId'])(
    'rejects forbidden %s before entering a use case',
    async (field) => {
      await expect(
        validate({ ...payload(), [field]: 'forbidden' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it.each([
    { ...payload(), cardToken: ' ' },
    { ...payload(), installments: '1' },
    { ...payload(), installments: 2 },
    { ...payload(), acceptance: null },
    {
      ...payload(),
      acceptance: { ...payload().acceptance, policyAccepted: 'true' },
    },
    {
      ...payload(),
      acceptance: { ...payload().acceptance, personalDataAccepted: false },
    },
    { ...payload(), acceptance: { ...payload().acceptance, unknown: true } },
  ])('rejects invalid structure/consent %p', async (p) => {
    await expect(validate(p)).rejects.toBeInstanceOf(BadRequestException);
  });
});
