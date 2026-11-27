import { useEffect, useState } from 'react';
import type { Attempt } from '../types';
import type { Flow } from '../state/flow';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import styles from '../App.module.css';
export function paymentPresentation(t: Attempt) {
  if (t.status === 'APPROVED')
    return {
      title: 'Compra confirmada',
      body: 'El pago fue verificado. Registramos tu pedido y actualizamos las existencias.',
      tone: 'success',
    };
  if (t.status === 'DECLINED')
    return {
      title: 'Pago rechazado',
      body: 'El pago fue rechazado y la reserva se liberó. Puedes volver a productos e iniciar una compra nueva.',
      tone: 'error',
    };
  if (t.status === 'VOIDED')
    return {
      title: 'Pago anulado',
      body: 'El pago fue anulado y la compra no se completó. No se descontaron existencias.',
      tone: 'error',
    };
  if (t.status === 'ERROR')
    return {
      title: 'No pudimos completar el pago',
      body: 'Ocurrió un problema al procesar la operación. La compra no fue confirmada.',
      tone: 'error',
    };
  if (t.status === 'EXPIRED')
    return {
      title: 'Reserva vencida',
      body: 'La reserva terminó antes de enviar el pago. Puedes volver a elegir tu producto.',
      tone: 'error',
    };
  if (t.dispatchStatus === 'UNKNOWN' || t.dispatchStatus === 'IN_FLIGHT')
    return {
      title: 'Resultado incierto',
      body: 'Aún no hay una confirmación suficiente. Conservamos la compra y su reserva: consulta el estado y no vuelvas a pagar.',
      tone: 'warning',
    };
  if (t.dispatchStatus === 'NOT_SENT')
    return {
      title: 'Pago preparado',
      body: 'El intento está creado, pero aún no se ha enviado. Puedes recuperar la compra e introducir la tarjeta nuevamente.',
      tone: 'warning',
    };
  return {
    title: 'Estamos verificando el pago',
    body: 'La operación fue enviada y estamos esperando su confirmación. No vuelvas a realizar el pago.',
    tone: 'warning',
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
  const tone = view.tone;
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
    <div className={styles.result} aria-busy={busy}>
      <div
        className={`${styles.resultSymbol} ${styles[tone]} ${
          attempt.status === 'PENDING' ? styles.resultSymbolActive : ''
        }`}
        aria-hidden="true"
      >
        {tone === 'success' ? (
          <CheckCircleOutlineIcon fontSize="large" />
        ) : attempt.status === 'PENDING' &&
          !['UNKNOWN', 'IN_FLIGHT'].includes(attempt.dispatchStatus) ? (
          <HourglassTopIcon fontSize="large" />
        ) : tone === 'warning' ? (
          <HelpOutlineIcon fontSize="large" />
        ) : attempt.status === 'ERROR' ? (
          <ErrorOutlineIcon fontSize="large" />
        ) : (
          <HighlightOffIcon fontSize="large" />
        )}
      </div>
      <span className={styles.eyebrow}>ESTADO DE TU COMPRA</span>
      <h2>{view.title}</h2>
      <p aria-live="polite">{view.body}</p>
      {busy && (
        <p className={styles.resultLoading} role="status">
          Actualizando el estado de tu compra
        </p>
      )}
      <div className={styles.resultReference}>
        <span>Referencia de compra</span>
        <strong>
          {attempt.reference ?? 'Disponible al consultar el detalle'}
        </strong>
      </div>
      <details className={styles.resultTechnical}>
        <summary>Identificadores técnicos</summary>
        <div>
          <span>Compra</span>
          <code>{attempt.checkoutId}</code>
        </div>
        <div>
          <span>Intento de pago</span>
          <code>{attempt.id}</code>
        </div>
        {attempt.deliveryId && (
          <div>
            <span>Registro de entrega</span>
            <code>{attempt.deliveryId}</code>
          </div>
        )}
      </details>
      {attempt.deliveryId && (
        <p>Registramos la información necesaria para gestionar la entrega.</p>
      )}
      {attempt.status === 'APPROVED' && (
        <p className={styles.resultTransition} role="status">
          Actualizamos el catálogo y tus compras. Volverás al inicio en unos
          segundos.
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
        onClick={() =>
          attempt.status === 'APPROVED'
            ? flow.finishApprovedTransition()
            : void flow.back()
        }
      >
        {attempt.status === 'APPROVED'
          ? 'Volver al inicio ahora'
          : 'Volver a los productos'}{' '}
        <span aria-hidden="true">↗</span>
      </button>
    </div>
  );
}
