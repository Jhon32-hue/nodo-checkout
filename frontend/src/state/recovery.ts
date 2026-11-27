import type { Attempt, PublicCheckout } from '../types';

export type RecoveryNotice = {
  message: string;
  action: 'continue' | 'status';
  canDiscard: boolean;
};

export function recoveryNotice(
  checkout: PublicCheckout | null,
  attempt: Attempt | null,
): RecoveryNotice | null {
  if (!checkout) return null;
  if (attempt && attempt.status !== 'PENDING') return null;
  if (!attempt)
    return {
      message: 'Tienes una compra sin terminar.',
      action: 'continue',
      canDiscard: checkout.status === 'DRAFT',
    };
  if (attempt.dispatchStatus === 'UNKNOWN')
    return {
      message:
        'Aún no pudimos confirmar el resultado. Puedes consultar su estado.',
      action: 'status',
      canDiscard: false,
    };
  if (attempt.dispatchStatus === 'IN_FLIGHT')
    return {
      message: 'Estamos enviando tu pago.',
      action: 'status',
      canDiscard: false,
    };
  if (attempt.dispatchStatus === 'SUBMITTED')
    return {
      message: 'El proveedor está verificando tu pago.',
      action: 'status',
      canDiscard: false,
    };
  return {
    message: 'Tienes una compra sin terminar.',
    action: 'continue',
    canDiscard: false,
  };
}
