export interface Environment {
  DB_HOST: string;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_PORT: number;
  PORT: number;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> & Environment {
  const errors: string[] = [];
  const requiredText = (key: string): string => {
    const value = input[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${key} is required and must be a non-empty string`);
      return '';
    }
    // Preserve passwords exactly as supplied, including meaningful whitespace.
    return value;
  };
  const requiredPort = (key: string): number => {
    const value = input[key];
    const port =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d+$/.test(value)
          ? Number(value)
          : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`${key} must be an integer between 1 and 65535`);
    }
    return port;
  };

  const environment: Environment = {
    DB_HOST: requiredText('DB_HOST'),
    DB_NAME: requiredText('DB_NAME'),
    DB_USER: requiredText('DB_USER'),
    DB_PASSWORD: requiredText('DB_PASSWORD'),
    DB_PORT: requiredPort('DB_PORT'),
    PORT: requiredPort('PORT'),
  };

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join('; ')}`);
  }

  return { ...input, ...environment };
}
