import { PaymentVisa, PaymentMastercard } from '@tabler/payments-react';
import { brand } from '../validation';
import styles from '../App.module.css';

export function CardBrands({ number }: { number: string }) {
  const recognized = brand(number);
  if (recognized === 'Tarjeta') return null;
  return (
    <span
      className={styles.cardBrand}
      aria-label={`Marca detectada: ${recognized}`}
    >
      {recognized === 'Visa' ? (
        <PaymentVisa size={34} title="Visa" />
      ) : (
        <PaymentMastercard size={34} title="Mastercard" />
      )}
    </span>
  );
}
