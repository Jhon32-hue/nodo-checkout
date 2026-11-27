import { useEffect, useState } from 'react';
import type { Attempt } from '../types';
import type { Flow } from '../state/flow';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import styles from '../App.module.css';
export function paymentPresentation(t: Attempt) {
  if (t.status === 'APPROVED')
    return {
      title: 'Compra aprobada',
      body: 'El pago fue verificado. Tu entrega está lista y el inventario actualizado.',
      symbol: '✓',
    };
  if (t.status === 'EXPIRED')
    return {
      title: 'Reserva vencida',
      body: 'La reserva terminó antes de enviar el pago. Puedes volver a elegir tu producto.',
      symbol: '↺',
    };
  if (t.status !== 'PENDING')
    return {
      title: 'Pago no aprobado',
      body: 'El proveedor confirmó el resultado negativo. No se descontaron existencias ni se creó una entrega.',
      symbol: '×',
    };
  if (t.dispatchStatus === 'UNKNOWN' || t.dispatchStatus === 'IN_FLIGHT')
    return {
      title: 'Resultado incierto',
      body: 'No hay confirmación suficiente del proveedor. Conservamos tu compra y su reserva. No vuelvas a pagar; requiere consulta o revisión.',
      symbol: '?',
    };
  if (t.dispatchStatus === 'NOT_SENT')
    return {
      title: 'Pago aún no enviado',
      body: 'El intento está creado, pero no se ha enviado. Recupera la compra e introduce la tarjeta otra vez.',
      symbol: '→',
    };
  return {
    title: 'Pago pendiente',
    body: 'Estamos esperando la confirmación de Wompi. No vuelvas a enviar el pago.',
    symbol: '…',
  };
}
export function Result({
  attempt,
  flow,
  busy,
}: {
  attempt: Attempt;
  flow: Flow;
  busy: boolean;
}) {
  const view = paymentPresentation(attempt);
  const tone =
    attempt.status === 'APPROVED'
      ? 'success'
      : attempt.status === 'PENDING'
        ? 'warning'
        : 'error';
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    if (
      attempt.status !== 'PENDING' ||
      !['SUBMITTED', 'IN_FLIGHT'].includes(attempt.dispatchStatus)
    )
      return;
    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) await flow.sync();
      if (cancelled) return;
      count++;
      if (count >= 8) {
        setStopped(true);
        return;
      }
      timer = setTimeout(() => void tick(), Math.min(5000 * 2 ** count, 30000));
    };
    timer = setTimeout(() => void tick(), 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt.id, attempt.status, attempt.dispatchStatus, flow]);
  return (
    <div className={styles.result}>
      <div
        className={`${styles.resultSymbol} ${styles[tone]}`}
        aria-hidden="true"
      >
        {tone === 'success' ? (
          <CheckCircleOutlineIcon fontSize="large" />
        ) : tone === 'warning' ? (
          <HelpOutlineIcon fontSize="large" />
        ) : (
          <HighlightOffIcon fontSize="large" />
        )}
      </div>
      <span className={styles.eyebrow}>ESTADO CONSULTADO EN NUESTRA API</span>
      <h2>{view.title}</h2>
      <p>{view.body}</p>
      <code>Compra · {attempt.checkoutId}</code>
      <code>Intento de pago · {attempt.id}</code>
      {attempt.deliveryId && (
        <p>
          Entrega lista: <code>{attempt.deliveryId}</code>
        </p>
      )}
      {stopped && attempt.status === 'PENDING' && (
        <p role="status">
          La consulta automática terminó. Puedes consultar manualmente sin
          volver a cobrar.
        </p>
      )}
      {attempt.status === 'PENDING' && (
        <button disabled={busy} onClick={() => void flow.sync()}>
          Consultar estado
        </button>
      )}
      {attempt.status === 'PENDING' &&
        attempt.dispatchStatus === 'NOT_SENT' && (
          <button disabled={busy} onClick={() => void flow.recover()}>
            Recuperar tarjeta y entrega
          </button>
        )}
      <button
        className={styles.textButton}
        disabled={busy}
        onClick={() => void flow.back()}
      >
        Volver a los productos <span aria-hidden="true">↗</span>
      </button>
    </div>
  );
}
