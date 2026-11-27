import { z } from 'zod';
const schema = z
  .object({
    checkoutId: z.uuid().optional(),
    transactionId: z.uuid().optional(),
    idempotencyKey: z.uuid().optional(),
    step: z.enum(['catalog', 'details', 'summary', 'result']),
  })
  .strict();
export type Progress = z.infer<typeof schema>;
export const STORAGE_KEY = 'nodo.checkout.v1';
export function loadProgress(storage: Storage = window.localStorage): Progress {
  try {
    const parsed = schema.safeParse(
      JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'),
    );
    return parsed.success ? parsed.data : { step: 'catalog' };
  } catch {
    return { step: 'catalog' };
  }
}
export function saveProgress(
  value: Progress,
  storage: Storage = window.localStorage,
) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(schema.parse(value)));
  } catch {
    throw new Error(
      'No se pudo guardar el progreso. Habilita almacenamiento local antes de pagar.',
    );
  }
}
