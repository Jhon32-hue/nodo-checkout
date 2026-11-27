import { BadRequestException, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { errAsync, okAsync } from 'neverthrow';
import type { CheckoutRequest } from '../../checkout/infrastructure/http/session-security';
import type { AttemptView } from '../../checkout/domain/transaction';
import {
  GetPaymentConfig,
  StartPayment,
  SyncPayment,
} from '../application/payment-cases';
import type { PublicPaymentConfig } from '../domain/payment';
import { PaymentsController } from './payments.controller';

const transactionId = '11111111-1111-4111-8111-111111111111';
const config: PublicPaymentConfig = {
  environment: 'UAT_SANDBOX',
  publicKey: 'public-test-key',
  tokenizationPublicKey: 'rsa-public-test-key',
  tokenizationUrl: 'https://sandbox.example.test/tokens',
  installments: 1,
  acceptance: {
    acceptanceToken: 'acceptance-test',
    personalAuthToken: 'personal-test',
    policyUrl: 'https://sandbox.example.test/policy',
    personalDataUrl: 'https://sandbox.example.test/privacy',
  },
};
const attempt = (
  status = 'PENDING',
  dispatchStatus = 'NOT_SENT',
): AttemptView => ({
  id: transactionId,
  checkoutId: '22222222-2222-4222-8222-222222222222',
  status,
  dispatchStatus,
  reservationExpiresAt: '2030-01-01T00:10:00.000Z',
  deliveryId: null,
});
const payBody = {
  cardToken: 'opaque-test-token',
  installments: 1,
  acceptance: {
    acceptanceToken: 'acceptance-test',
    personalAuthToken: 'personal-test',
    policyAccepted: true,
    personalDataAccepted: true,
  },
};

function request(
  headers: Record<string, string | undefined> = {},
): CheckoutRequest {
  return {
    headers,
    checkoutSession: {
      id: 'owner-session',
      expiresAt: new Date('2030-01-01T01:00:00.000Z'),
    },
  } as unknown as CheckoutRequest;
}

function response() {
  const status = jest.fn();
  const setHeader = jest.fn();
  return {
    value: { status, setHeader } as unknown as Response,
    status,
    setHeader,
  };
}

function fixture() {
  const configuration = jest
    .fn<
      ReturnType<GetPaymentConfig['execute']>,
      Parameters<GetPaymentConfig['execute']>
    >()
    .mockImplementationOnce(() => okAsync(config));
  const pay = jest
    .fn<
      ReturnType<StartPayment['execute']>,
      Parameters<StartPayment['execute']>
    >()
    .mockImplementationOnce(() => okAsync(attempt('APPROVED', 'SUBMITTED')));
  const sync = jest
    .fn<
      ReturnType<SyncPayment['execute']>,
      Parameters<SyncPayment['execute']>
    >()
    .mockImplementationOnce(() => okAsync(attempt('APPROVED', 'SUBMITTED')));
  const controller = new PaymentsController(
    { execute: configuration } as unknown as GetPaymentConfig,
    { execute: pay } as unknown as StartPayment,
    { execute: sync } as unknown as SyncPayment,
  );
  return { controller, configuration, pay, sync };
}

async function httpError(operation: Promise<unknown>): Promise<HttpException> {
  const error: unknown = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(HttpException);
  if (!(error instanceof HttpException))
    throw new Error('Expected HTTP exception');
  expect(error.getResponse()).toHaveProperty('error.code');
  expect(error.getResponse()).toHaveProperty('error.message');
  return error;
}

describe('PaymentsController behavior', () => {
  it('preserves the public configuration projection from the use case', async () => {
    const { controller, configuration, pay, sync } = fixture();
    const result = await controller.configuration();
    expect(result).toEqual({ data: config });
    expect(configuration).toHaveBeenCalledTimes(1);
    expect(configuration).toHaveBeenCalledWith();
    expect(pay).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /privateKey|authorization|cookie|password/i,
    );
  });

  it('maps provider configuration and acceptance failures safely', async () => {
    const { controller, configuration, pay } = fixture();
    configuration.mockReset().mockImplementationOnce(() =>
      errAsync({
        kind: 'GATEWAY_UNAVAILABLE' as const,
        operation: 'configuration' as const,
        reason: 'transport' as const,
      }),
    );
    const unavailable = await httpError(controller.configuration());
    expect(unavailable).toBeInstanceOf(HttpException);
    expect(unavailable.getStatus()).toBe(503);
    expect(JSON.stringify(unavailable.getResponse())).not.toMatch(
      /stack|authorization|private|body/i,
    );

    pay
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'INVALID_ACCEPTANCE' as const }),
      );
    const invalid = await httpError(
      controller.pay(request(), transactionId, payBody, response().value),
    );
    expect(invalid).toBeInstanceOf(HttpException);
    expect(invalid.getStatus()).toBe(422);
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay).toHaveBeenCalledWith('owner-session', transactionId, payBody);
    expect(configuration).toHaveBeenCalledTimes(1);
    expect(configuration).toHaveBeenCalledWith();
    expect(JSON.stringify(invalid.getResponse())).not.toContain(
      payBody.acceptance.acceptanceToken,
    );
  });

  it('returns 200 for a final pay result and invokes pay exactly once', async () => {
    const { controller, pay, sync } = fixture();
    const res = response();
    await expect(
      controller.pay(request(), transactionId, payBody, res.value),
    ).resolves.toEqual({ data: attempt('APPROVED', 'SUBMITTED') });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay).toHaveBeenCalledWith('owner-session', transactionId, payBody);
    expect(sync).not.toHaveBeenCalled();
  });

  it('returns 202 and Retry-After for an already dispatched pending result', async () => {
    const { controller, pay } = fixture();
    pay
      .mockReset()
      .mockImplementationOnce(() => okAsync(attempt('PENDING', 'UNKNOWN')));
    const res = response();
    await expect(
      controller.pay(request(), transactionId, payBody, res.value),
    ).resolves.toEqual({ data: attempt('PENDING', 'UNKNOWN') });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay).toHaveBeenCalledWith('owner-session', transactionId, payBody);
  });

  it('syncs only from the explicit operation and never invokes pay', async () => {
    const { controller, pay, sync } = fixture();
    sync
      .mockReset()
      .mockImplementationOnce(() => okAsync(attempt('PENDING', 'SUBMITTED')));
    const res = response();
    await expect(
      controller.sync(request(), transactionId, res.value),
    ).resolves.toEqual({ data: attempt('PENDING', 'SUBMITTED') });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('owner-session', transactionId);
    expect(pay).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('rejects sync request bodies before any financial use case', async () => {
    const { controller, pay, sync } = fixture();
    await expect(
      controller.sync(
        request({ 'content-length': '2' }),
        transactionId,
        response().value,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.sync(
        request({ 'transfer-encoding': 'chunked' }),
        transactionId,
        response().value,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sync).not.toHaveBeenCalled();
    expect(pay).not.toHaveBeenCalled();
  });

  it('maps missing ownership and persistence failures without exposing internals', async () => {
    const { controller, pay, sync } = fixture();
    pay
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'RESOURCE_NOT_FOUND' as const }),
      );
    sync
      .mockReset()
      .mockImplementationOnce(() =>
        errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' as const }),
      );

    const missing = await httpError(
      controller.pay(request(), transactionId, payBody, response().value),
    );
    const unavailable = await httpError(
      controller.sync(request(), transactionId, response().value),
    );
    expect(missing).toBeInstanceOf(HttpException);
    expect(unavailable).toBeInstanceOf(HttpException);
    expect(missing.getStatus()).toBe(404);
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay).toHaveBeenCalledWith('owner-session', transactionId, payBody);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('owner-session', transactionId);
    expect(unavailable.getStatus()).toBe(503);
    expect(JSON.stringify(unavailable.getResponse())).not.toMatch(
      /postgres|query|constraint|stack/i,
    );
  });
});
