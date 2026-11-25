import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { validateEnvironment } from '../../config/environment';

export function loadDatabaseEnvironment() {
  // Same precedence as ConfigModule: process, .env, ../.env. Node 24 built-in API.
  for (const relativePath of ['.env', '../.env']) {
    const path = resolve(process.cwd(), relativePath);
    if (!existsSync(path)) continue;
    // Accept Windows UTF-8 BOM files, as ConfigModule/dotenv already does.
    const values = parseEnv(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
  return validateEnvironment(process.env);
}
