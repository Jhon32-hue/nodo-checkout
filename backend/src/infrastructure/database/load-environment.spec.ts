import fs from 'node:fs';
import { resolve } from 'node:path';
import { loadDatabaseEnvironment } from './load-environment';

describe('database CLI environment', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {};
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it('accepts injected deployment variables without requiring an env file', () => {
    process.env = {
      DB_HOST: 'db',
      DB_NAME: 'test',
      DB_USER: 'test',
      DB_PASSWORD: 'test-only',
      DB_PORT: '5432',
      PORT: '3000',
    };
    expect(loadDatabaseEnvironment()).toMatchObject({
      DB_HOST: 'db',
      DB_PORT: 5432,
    });
  });

  it('accepts Windows BOM and preserves process > .env > ../.env precedence', () => {
    process.env.DB_HOST = 'injected-host';
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest
      .spyOn(fs, 'readFileSync')
      .mockImplementation((path) =>
        String(path) === resolve('.env')
          ? '\uFEFFDB_HOST=local-host\nDB_NAME=local-db\nDB_PORT=5433\n'
          : 'DB_NAME=parent-db\nDB_USER=test\nDB_PASSWORD=" test-only "\nDB_PORT=5432\nPORT=3000\n',
      );
    expect(loadDatabaseEnvironment()).toMatchObject({
      DB_HOST: 'injected-host',
      DB_NAME: 'local-db',
      DB_PORT: 5433,
      DB_PASSWORD: ' test-only ',
      PORT: 3000,
    });
  });

  it('reuses configuration validation rather than silently choosing defaults', () => {
    expect(() => loadDatabaseEnvironment()).toThrow('DB_HOST');
    process.env.DB_PORT = 'invalid';
    expect(() => loadDatabaseEnvironment()).toThrow('DB_PORT');
  });
});
