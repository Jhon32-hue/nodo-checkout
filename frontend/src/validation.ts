import { z } from 'zod';
export const money = (cents: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(cents / 100);
export function luhn(value: string) {
  const digits = value.replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 1, even = false; i >= 0; i--, even = !even) {
    let d = Number(digits[i]);
    if (even) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
export function brand(value: string) {
  const n = value.replace(/\s/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n)) return 'Mastercard';
  if (n.length >= 4 && /^\d{4}/.test(n)) {
    const prefix = Number(n.slice(0, 4));
    if (prefix >= 2221 && prefix <= 2720) return 'Mastercard';
  }
  return 'Tarjeta';
}
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'Usa formato internacional: +573001234567');
const name = z
  .string()
  .trim()
  .min(2, 'Escribe al menos 2 caracteres')
  .max(120, 'Máximo 120 caracteres');
export const buyerSchema = z.object({
  fullName: name,
  email: z.email('Escribe un correo válido').max(254),
  phone,
});
export const deliverySchema = z.object({
  recipientName: name,
  phone,
  addressLine1: z
    .string()
    .trim()
    .min(3, 'Escribe la dirección completa')
    .max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, 'Escribe la ciudad').max(100),
  region: z.string().trim().min(2, 'Escribe el departamento').max(100),
  country: z.literal('CO'),
  postalCode: z.string().trim().max(12).optional(),
});
export const cardSchema = z
  .object({
    number: z.string().refine(luhn, 'Revisa el número de tarjeta'),
    holder: name,
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'Mes entre 01 y 12'),
    year: z.string().regex(/^\d{4}$/, 'Año de 4 dígitos'),
    cvc: z.string().regex(/^\d{3,4}$/, 'CVC de 3 o 4 dígitos'),
  })
  .refine(
    (c) => {
      const now = new Date();
      return (
        Number(c.year) > now.getFullYear() ||
        (Number(c.year) === now.getFullYear() &&
          Number(c.month) >= now.getMonth() + 1)
      );
    },
    { message: 'La tarjeta está vencida', path: ['year'] },
  );
export const formSchema = z.object({
  buyer: buyerSchema,
  delivery: deliverySchema,
  card: cardSchema,
  policy: z.boolean().refine(Boolean, 'Acepta el contrato de pago'),
  personal: z.boolean().refine(Boolean, 'Autoriza el tratamiento de datos'),
});
export type FormValues = z.infer<typeof formSchema>;
export const quantityValid = (n: number, available: number) =>
  Number.isInteger(n) && n >= 1 && n <= Math.min(99, available);
export function message(error: unknown) {
  const code = error instanceof Error && 'code' in error ? error.code : '';
  return (
    (
      {
        SUMMARY_CHANGED:
          'Los importes cambiaron. Revisa el nuevo resumen y confirma otra vez.',
        INSUFFICIENT_STOCK: 'La disponibilidad cambió. Vuelve al catálogo.',
        TOKENIZATION:
          'No pudimos preparar el pago con tarjeta. Inténtalo de nuevo más tarde.',
        RESOURCE_NOT_FOUND: 'Esta compra no está disponible en tu sesión.',
        UNAUTHORIZED:
          'La sesión venció. No vuelvas a enviar un pago pendiente.',
        RESERVATION_EXPIRED: 'La reserva venció sin cobro. Vuelve al catálogo.',
        INVALID_ACCEPTANCE:
          'Los contratos cambiaron. Vuelve a introducir la tarjeta y aceptar los enlaces vigentes.',
      } as Record<string, string>
    )[String(code)] ??
    'No pudimos completar la solicitud. Consulta el estado antes de intentar pagar de nuevo.'
  );
}
