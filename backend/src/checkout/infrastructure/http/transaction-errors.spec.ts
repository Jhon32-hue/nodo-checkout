import { failure } from './session-security';
describe('transaction HTTP error translation', () => {
  it.each([
    'IDEMPOTENCY_CONFLICT',
    'SUMMARY_CHANGED',
    'INSUFFICIENT_STOCK',
    'CHECKOUT_LOCKED',
  ] as const)('maps %s to conflict', (kind) => {
    const error = failure({ kind });
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      error: { code: kind, message: kind },
    });
  });
  it.each([
    ['RESOURCE_NOT_FOUND', 404],
    ['SESSION_REQUIRED', 401],
    ['CSRF_INVALID', 403],
    ['INCOMPLETE_CHECKOUT', 422],
    ['PERSISTENCE_UNAVAILABLE', 503],
  ] as const)('maps %s without SQL details', (kind, status) => {
    const error = failure({ kind });
    expect(error.getStatus()).toBe(status);
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /postgres|query|constraint|password/i,
    );
  });
});
