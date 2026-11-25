import { validateEnvironment } from './environment';

const validEnvironment = {
  DB_HOST: '127.0.0.1',
  DB_NAME: 'payment_checkout',
  DB_USER: 'checkout',
  DB_PASSWORD: 'test-only-password',
  DB_PORT: '5433',
  PORT: '3000',
};

describe('validateEnvironment', () => {
  it('converts ports and preserves injected deployment variables', () => {
    expect(
      validateEnvironment({ ...validEnvironment, NODE_ENV: 'production' }),
    ).toEqual({
      ...validEnvironment,
      DB_PORT: 5433,
      PORT: 3000,
      NODE_ENV: 'production',
    });
  });

  it.each(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'])(
    'rejects missing, empty or whitespace-only %s',
    (key) => {
      for (const value of [undefined, '', '   ', null, 123]) {
        expect(() =>
          validateEnvironment({ ...validEnvironment, [key]: value }),
        ).toThrow(`${key} is required and must be a non-empty string`);
      }
    },
  );

  describe.each(['DB_PORT', 'PORT'])('%s', (key) => {
    it.each([
      undefined,
      null,
      '',
      ' ',
      ' 3000 ',
      'abc',
      '1.5',
      '1e3',
      '0x50',
      '0',
      '-1',
      '65536',
      0,
      -1,
      65536,
      1.5,
      NaN,
      Infinity,
      true,
    ])('rejects invalid port %p', (value) => {
      expect(() =>
        validateEnvironment({ ...validEnvironment, [key]: value }),
      ).toThrow(`${key} must be an integer between 1 and 65535`);
    });

    it.each([1, 65535, '1', '65535'])('accepts valid boundary %p', (value) => {
      expect(
        validateEnvironment({ ...validEnvironment, [key]: value })[key],
      ).toBe(Number(value));
    });
  });

  it('reports all missing fields without including supplied secrets', () => {
    expect(() =>
      validateEnvironment({ DB_PASSWORD: 'sensitive-test-value' }),
    ).toThrow('DB_HOST');
    try {
      validateEnvironment({ DB_PASSWORD: 'sensitive-test-value' });
    } catch (error) {
      expect(String(error)).toContain('PORT');
      expect(String(error)).not.toContain('sensitive-test-value');
    }
  });

  it('rejects an entirely missing configuration', () => {
    for (const key of Object.keys(validEnvironment)) {
      expect(() => validateEnvironment({})).toThrow(key);
    }
  });

  it('preserves the exact password', () => {
    expect(
      validateEnvironment({ ...validEnvironment, DB_PASSWORD: ' pass ' })
        .DB_PASSWORD,
    ).toBe(' pass ');
  });
});
