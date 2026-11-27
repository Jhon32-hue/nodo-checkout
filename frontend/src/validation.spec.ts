import {
  luhn,
  brand,
  cardSchema,
  buyerSchema,
  deliverySchema,
  formSchema,
  quantityValid,
  message,
  money,
  formatCardNumber,
  normalizeCardNumber,
  cardNumberError,
  cardNumberMax,
} from './validation';
import { ApiError } from './services/api';
import { card, buyer, delivery } from '../test/fixtures';
describe('Validaciones del formulario', () => {
  it('valida Luhn, longitud y entrada de texto', () => {
    expect(luhn(card.number)).toBe(true);
    expect(luhn('4242 4242 4242 4242')).toBe(true);
    expect(luhn('4242-4242-4242-4242')).toBe(true);
    for (const n of [
      '',
      'abc',
      '1'.repeat(12),
      '1'.repeat(20),
      '0'.repeat(16),
      card.number.slice(0, -1) + '2',
    ])
      expect(luhn(n)).toBe(false);
  });
  it('normaliza y presenta el número sin exceder 19 dígitos', () => {
    expect(normalizeCardNumber('4242- 4242 abc 4242-4242')).toBe(
      '4242424242424242',
    );
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(normalizeCardNumber('1'.repeat(25))).toHaveLength(19);
    expect(normalizeCardNumber('5555555555554444999')).toHaveLength(16);
    expect(cardNumberMax('5555')).toBe(16);
    expect(cardNumberMax('4242')).toBe(19);
  });
  it('explica vacío, marca, longitud y Luhn sin exponer detalles técnicos', () => {
    expect(cardNumberError('')).toBe('Ingresa el número de la tarjeta.');
    expect(cardNumberError('1234')).toBe(
      'Solo aceptamos tarjetas Visa o Mastercard.',
    );
    expect(cardNumberError('4242')).toContain('Faltan 9 dígitos');
    expect(cardNumberError('555555555555444')).toContain('Falta 1 dígito');
    expect(cardNumberError('4242424242424241')).toBe(
      'El número no es válido. Revisa que los dígitos estén correctos.',
    );
  });
  it('detecta marcas y formatea centavos en COP', () => {
    expect(brand(card.number)).toBe('Visa');
    expect(brand('5500')).toBe('Mastercard');
    expect(brand('2222')).toBe('Mastercard');
    expect(brand('2221')).toBe('Mastercard');
    expect(brand('2720')).toBe('Mastercard');
    expect(brand('2220')).toBe('Tarjeta');
    expect(brand('2721')).toBe('Tarjeta');
    expect(brand('50')).toBe('Tarjeta');
    expect(brand('56')).toBe('Tarjeta');
    expect(brand('4')).toBe('Visa');
    expect(brand('')).toBe('Tarjeta');
    expect(brand('123')).toBe('Tarjeta');
    expect(money(12990000)).toContain('129.900');
  });
  it.each([
    { month: '13' },
    { month: '00' },
    { year: '2000' },
    { year: '30' },
    { cvc: '12' },
    { cvc: 'abcdef' },
    { holder: 'x' },
    { number: 'invalid' },
  ])('rechaza tarjeta inválida %p', (patch) =>
    expect(cardSchema.safeParse({ ...card, ...patch }).success).toBe(false),
  );
  it('acepta este mes y rechaza el mes pasado', () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-06-15'));
    expect(
      cardSchema.safeParse({ ...card, year: '2030', month: '06' }).success,
    ).toBe(true);
    expect(
      cardSchema.safeParse({ ...card, year: '2030', month: '05' }).success,
    ).toBe(false);
    jest.useRealTimers();
  });
  it('valida comprador, destino y consentimientos independientes', () => {
    expect(buyerSchema.safeParse(buyer).success).toBe(true);
    expect(deliverySchema.safeParse(delivery).success).toBe(true);
    expect(
      buyerSchema.safeParse({ ...buyer, phone: '3001234567' }).success,
    ).toBe(false);
    expect(
      deliverySchema.safeParse({ ...delivery, country: 'US' }).success,
    ).toBe(false);
    for (const pair of [
      [false, true],
      [true, false],
      [false, false],
    ])
      expect(
        formSchema.safeParse({
          buyer,
          delivery,
          card,
          policy: pair[0],
          personal: pair[1],
        }).success,
      ).toBe(false);
    expect(
      formSchema.safeParse({
        buyer,
        delivery,
        card,
        policy: true,
        personal: true,
      }).success,
    ).toBe(true);
  });
  it('limita cantidades y no expone errores externos', () => {
    for (const n of [0, 100, 1.1, NaN])
      expect(quantityValid(n, 1000)).toBe(false);
    expect(quantityValid(1, 0)).toBe(false);
    expect(quantityValid(99, 100)).toBe(true);
    expect(message(new Error('secret-message'))).not.toContain('secret');
    expect(message(new ApiError('SUMMARY_CHANGED'))).toContain('importes');
    expect(message(new ApiError('TOKENIZATION'))).toContain(
      'validar la tarjeta',
    );
    expect(message(new ApiError('SANDBOX_CARD_NOT_ALLOWED'))).toBe(
      'Esta tarjeta no está habilitada para las pruebas. Usa una de las tarjetas de prueba indicadas en el formulario.',
    );
    expect(message(new ApiError('TOKENIZATION_NETWORK'))).toContain(
      'servicio de pagos',
    );
    expect(message(new ApiError('TOKENIZATION_INVALID_RESPONSE'))).toContain(
      'forma inesperada',
    );
    expect(message(new ApiError('GATEWAY_UNAVAILABLE'))).toContain(
      'servicio de pagos',
    );
    expect(message(new ApiError('PAYMENT_RESULT_UNKNOWN'))).toContain(
      'No repetiremos el cobro',
    );
    expect(message(new ApiError('NETWORK'))).toContain('conexión');
    for (const c of [
      'INSUFFICIENT_STOCK',
      'TOKENIZATION',
      'RESOURCE_NOT_FOUND',
      'UNAUTHORIZED',
      'RESERVATION_EXPIRED',
      'INVALID_ACCEPTANCE',
    ])
      expect(message(new ApiError(c)).length).toBeGreaterThan(10);
  });
});
