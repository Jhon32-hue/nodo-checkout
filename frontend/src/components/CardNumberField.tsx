import { useLayoutEffect, useRef, type ClipboardEvent, type Ref } from 'react';
import TextField from '@mui/material/TextField';
import { CardBrands } from './CardBrands';
import { formatCardNumber, normalizeCardNumber } from '../validation';
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
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
  error: boolean;
  helperText?: string;
}) {
  const element = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
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
        onBlur={onBlur}
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
            maxLength: 23,
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
              const digits = normalizeCardNumber(
                prefixDigits + pastedDigits + normalizeCardNumber(after),
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
        error={error}
        helperText={helperText}
      />
      <CardBrands number={value} />
    </div>
  );
}
