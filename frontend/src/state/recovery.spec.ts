import { recoveryNotice } from './recovery';
import { attempt, checkout } from '../../test/fixtures';

it('describe únicamente estados recuperables y omite terminales', () => {
  expect(recoveryNotice(checkout, null)).toMatchObject({
    message: 'Tienes una compra sin terminar.',
    canDiscard: true,
  });
  expect(
    recoveryNotice(checkout, { ...attempt, dispatchStatus: 'IN_FLIGHT' })
      ?.message,
  ).toContain('enviando');
  expect(
    recoveryNotice(checkout, { ...attempt, dispatchStatus: 'SUBMITTED' })
      ?.message,
  ).toContain('verificando');
  expect(
    recoveryNotice(checkout, { ...attempt, dispatchStatus: 'UNKNOWN' })
      ?.message,
  ).toContain('consultar');
  for (const status of [
    'APPROVED',
    'DECLINED',
    'ERROR',
    'VOIDED',
    'EXPIRED',
  ] as const)
    expect(
      recoveryNotice(checkout, {
        ...attempt,
        status,
        dispatchStatus: status === 'EXPIRED' ? 'NOT_SENT' : 'SUBMITTED',
      }),
    ).toBeNull();
});
