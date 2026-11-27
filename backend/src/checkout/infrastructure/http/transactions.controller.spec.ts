import { BadRequestException } from '@nestjs/common';
import { errAsync, okAsync } from 'neverthrow';
import {
  CreateTransaction,
  GetTransaction,
  ListTransactions,
} from '../../application/transaction-cases';
import type {
  AttemptDetails,
  AttemptView,
  PurchaseHistoryItem,
} from '../../domain/transaction';
import type { CheckoutRequest } from './session-security';
import { TransactionsController } from './transactions.controller';

const owner = 'owner-session';
const transactionId = '11111111-1111-4111-8111-111111111111';
const checkoutId = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const attempt: AttemptView = {
  id: transactionId,
  checkoutId,
  status: 'PENDING',
  dispatchStatus: 'NOT_SENT',
  reservationExpiresAt: '2030-01-01T00:10:00.000Z',
  deliveryId: null,
};
const details: AttemptDetails = {
  ...attempt,
  reference: 'purchase-reference',
  summary: {
    quantity: 1,
    unitPriceCents: 10000,
    subtotalCents: 10000,
    baseFeeCents: 50000,
    deliveryFeeCents: 100000,
    totalCents: 160000,
    currency: 'COP',
  },
  createdAt: '2030-01-01T00:00:00.000Z',
  finalizedAt: null,
  reservationStatus: 'HELD',
  reservationExpired: false,
};
const history: PurchaseHistoryItem = {
  id: transactionId,
  checkoutId,
  productName: 'Producto de prueba',
  quantity: 1,
  totalCents: 160000,
  currency: 'COP',
  reference: 'purchase-reference',
  status: 'PENDING',
  dispatchStatus: 'NOT_SENT',
  createdAt: '2030-01-01T00:00:00.000Z',
  deliveryId: null,
};
const acceptedSummary = {
  quantity: 1,
  unitPriceCents: 10000,
  baseFeeCents: 50000,
  deliveryFeeCents: 100000,
  currency: 'COP',
};

function request(): CheckoutRequest {
  return {
    checkoutSession: {
      id: owner,
      expiresAt: new Date('2030-01-01T01:00:00.000Z'),
    },
  } as unknown as CheckoutRequest;
}

function fixture() {
  const create = jest.fn(() => okAsync(attempt));
  const get = jest.fn(() => okAsync(details));
  const list = jest.fn(() => okAsync([history]));
  const controller = new TransactionsController(
    { execute: create } as unknown as CreateTransaction,
    { execute: get } as unknown as GetTransaction,
    { execute: list } as unknown as ListTransactions,
  );
  return { controller, create, get, list };
}

describe('TransactionsController', () => {
  it('lists only the use-case projection and performs no financial operation', async () => {
    const { controller, create, get, list } = fixture();
    const result = await controller.list(request());

    expect(result).toEqual({ data: { items: [history] } });
    expect(list).toHaveBeenCalledWith(owner);
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /providerTransactionId|acceptance|cardToken|email|address/i,
    );
  });

  it('returns an empty history and sanitizes read failures', async () => {
    const { controller, list } = fixture();
    list.mockImplementationOnce(() => okAsync([]));
    await expect(controller.list(request())).resolves.toEqual({
      data: { items: [] },
    });

    list.mockImplementationOnce(() =>
      errAsync({ kind: 'PERSISTENCE_UNAVAILABLE' as const }),
    );
    const error: unknown = await controller
      .list(request())
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 503 });
    expect(error).toBeInstanceOf(Error);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).not.toMatch(/postgres|query|constraint|stack/i);
  });

  it('creates exactly one attempt with owner, key and accepted summary', async () => {
    const { controller, create, get, list } = fixture();
    await expect(
      controller.create(request(), key, { checkoutId, acceptedSummary }),
    ).resolves.toEqual({ data: attempt });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      owner,
      checkoutId,
      key,
      acceptedSummary,
    );
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed idempotency key before creating', async () => {
    const { controller, create } = fixture();
    await expect(
      controller.create(request(), undefined, { checkoutId, acceptedSummary }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.create(request(), 'not-a-uuid', {
        checkoutId,
        acceptedSummary,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('translates transaction conflicts without exposing persistence details', async () => {
    const { controller, create } = fixture();
    create.mockImplementation(() =>
      errAsync({ kind: 'IDEMPOTENCY_CONFLICT' as const }),
    );
    const error: unknown = await controller
      .create(request(), key, { checkoutId, acceptedSummary })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 409 });
    expect(error).toBeInstanceOf(Error);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).not.toMatch(/postgres|query|constraint|stack/i);
  });

  it('reads owned details without creating, paying or synchronizing', async () => {
    const { controller, create, get, list } = fixture();
    const result = await controller.get(request(), transactionId);
    expect(result).toEqual({ data: details });
    expect(get).toHaveBeenCalledWith(owner, transactionId);
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /providerTransactionId|cardToken|acceptance|email|address/i,
    );
  });

  it('makes foreign and nonexistent attempts indistinguishable', async () => {
    const { controller, get } = fixture();
    get.mockImplementation(() =>
      errAsync({ kind: 'RESOURCE_NOT_FOUND' as const }),
    );
    const foreign: unknown = await controller
      .get(request(), transactionId)
      .catch((value: unknown) => value);
    const missing: unknown = await controller
      .get(request(), transactionId)
      .catch((value: unknown) => value);
    expect(foreign).toBeInstanceOf(Error);
    expect(missing).toBeInstanceOf(Error);
    expect((foreign as BadRequestException).getStatus()).toBe(404);
    expect((foreign as BadRequestException).getResponse()).toEqual(
      (missing as BadRequestException).getResponse(),
    );
  });
});
