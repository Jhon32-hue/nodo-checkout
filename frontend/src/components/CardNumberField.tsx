import {
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Ref,
} from 'react';
import TextField from '@mui/material/TextField';
import { CardBrands } from './CardBrands';
import {
  cardNumberMax,
  formatCardNumber,
  normalizeCardNumber,
} from '../validation';
import styles from '../App.module.css';

const caretAfterDigits = (formatted: string, count: number) => {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index++) {
    if (/\d/.test(formatted[index]) && ++seen === count) return index + 1;
  }
  return formatted.length;
};

const assignRef = (
  ref: Ref<HTMLInputElement>,
  node: HTMLInputElement | null,
) => {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
};

export function CardNumberField({
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  helperText,
  onValidate,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
  error: boolean;
  helperText?: string;
  onValidate?: () => void;
}) {
  const element = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [overflowMessage, setOverflowMessage] = useState('');
  const formatted = formatCardNumber(value);

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !element.current) return;
    element.current.setSelectionRange(
      pendingCaret.current,
      pendingCaret.current,
    );
    pendingCaret.current = null;
  }, [formatted]);

  const update = (raw: string, rawCaret: number) => {
    const rawDigits = raw.replace(/\D/g, '');
    const max = cardNumberMax(rawDigits);
    setOverflowMessage(
      rawDigits.length > max ? `El número admite máximo ${max} dígitos.` : '',
    );
    const digitsBeforeCaret = normalizeCardNumber(
      raw.slice(0, rawCaret),
    ).length;
    const digits = normalizeCardNumber(raw);
    pendingCaret.current = caretAfterDigits(
      formatCardNumber(digits),
      Math.min(digitsBeforeCaret, digits.length),
    );
    onChange(digits);
  };

  return (
    <div className={styles.cardNumberField}>
      <TextField
        label="Número de tarjeta"
        id="card.number"
        value={formatted}
        onBlur={() => {
          onBlur();
          onValidate?.();
        }}
        onChange={(event) =>
          update(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length,
          )
        }
        inputRef={(node: HTMLInputElement | null) => {
          element.current = node;
          assignRef(inputRef, node);
        }}
        slotProps={{
          htmlInput: {
            inputMode: 'numeric',
            pattern: '[0-9 -]*',
            maxLength:
              cardNumberMax(value) + Math.floor((cardNumberMax(value) - 1) / 4),
            autoComplete: 'off',
            'aria-label': 'Número de tarjeta',
            onPaste: (event: ClipboardEvent<HTMLInputElement>) => {
              event.preventDefault();
              const input = event.currentTarget;
              const start = input.selectionStart ?? formatted.length;
              const end = input.selectionEnd ?? start;
              const before = formatted.slice(0, start);
              const after = formatted.slice(end);
              const prefixDigits = normalizeCardNumber(before);
              const pastedDigits = normalizeCardNumber(
                event.clipboardData.getData('text'),
              );
              const pastedRaw = event.clipboardData
                .getData('text')
                .replace(/\D/g, '');
              const combinedRaw =
                prefixDigits + pastedRaw + normalizeCardNumber(after);
              const max = cardNumberMax(combinedRaw);
              setOverflowMessage(
                combinedRaw.length > max
                  ? `El número admite máximo ${max} dígitos.`
                  : '',
              );
              const digits = normalizeCardNumber(
                prefixDigits + pastedRaw + normalizeCardNumber(after),
              );
              pendingCaret.current = caretAfterDigits(
                formatCardNumber(digits),
                Math.min(
                  prefixDigits.length + pastedDigits.length,
                  digits.length,
                ),
              );
              onChange(digits);
            },
          },
          formHelperText: { role: 'alert' },
        }}
        error={error || !!overflowMessage}
        helperText={overflowMessage || helperText}
      />
      <CardBrands number={value} />
    </div>
  );
}
