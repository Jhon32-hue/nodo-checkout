import { EncryptJWT, importSPKI } from 'jose';
import type { Card, Config } from '../types';
import { ApiError } from './api';
import { normalizeCardNumber } from '../validation';
export const UAT = 'https://api-sandbox.co.uat.wompi.dev';
export class TokenizationError extends ApiError {
  constructor(
    readonly stage: 'key' | 'card',
    readonly reason: 'transport' | 'http' | 'json' | 'schema' | 'crypto',
    readonly httpStatus?: number,
  ) {
    super('TOKENIZATION');
  }
}
export function normalizePem(value: string) {
  const raw = value
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) throw new ApiError('TOKENIZATION');
  return (
    '-----BEGIN PUBLIC KEY-----\n' +
    raw.match(/.{1,64}/g)!.join('\n') +
    '\n-----END PUBLIC KEY-----'
  );
}
export async function tokenize(card: Card, config: Config): Promise<string> {
  if (
    config.environment !== 'UAT_SANDBOX' ||
    config.tokenizationUrl !== UAT + '/v1/tokens/cards' ||
    !/^pub_(?:stagtest|test)_/.test(config.publicKey)
  )
    throw new ApiError('TOKENIZATION');
  const headers = { Authorization: 'Bearer ' + config.publicKey };
  let stage: 'key' | 'card' = 'key';
  let reason: TokenizationError['reason'] = 'schema';
  try {
    const key = await importSPKI(
      normalizePem(config.tokenizationPublicKey),
      'RSA-OAEP-256',
    );
    reason = 'crypto';
    const payload = await new EncryptJWT({
      number: normalizeCardNumber(card.number),
      exp_month: card.month.padStart(2, '0'),
      exp_year: card.year.slice(-2),
      cvc: card.cvc,
      card_holder: card.holder,
    })
      .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
      .encrypt(key);
    stage = 'card';
    reason = 'transport';
    const result = await fetch(config.tokenizationUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    if (!result.ok) throw new TokenizationError('card', 'http', result.status);
    reason = 'json';
    const token = await result.json();
    reason = 'schema';
    if (typeof token?.data?.id !== 'string' || !token.data.id.trim())
      throw new TokenizationError('card', 'schema', result.status);
    return token.data.id;
  } catch (error) {
    if (error instanceof TokenizationError) throw error;
    throw new TokenizationError(stage, reason);
  }
}
