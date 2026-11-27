import { quantityValid } from '../validation';
import styles from '../App.module.css';

export function QuantityStepper({
  quantity,
  available,
  onChange,
  label,
}: {
  quantity: number;
  available: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const max = Math.min(99, available);
  return (
    <div className={styles.quantity} aria-label={label}>
      <button
        type="button"
        aria-label={`Reducir ${label}`}
        disabled={quantity <= 1}
        onClick={() => onChange(quantity - 1)}
      >
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        type="number"
        min={1}
        max={max}
        value={quantity}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (quantityValid(n, available)) onChange(n);
        }}
      />
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={quantity >= max}
        onClick={() => onChange(quantity + 1)}
      >
        +
      </button>
    </div>
  );
}
