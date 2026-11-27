import type { PurchaseHistoryItem } from '../types';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import Skeleton from '@mui/material/Skeleton';
import styles from '../App.module.css';

export function purchaseStatus(item: PurchaseHistoryItem) {
  if (item.status === 'APPROVED')
    return { label: 'Confirmada', tone: 'success', icon: 'approved' } as const;
  if (item.status === 'PENDING') {
    if (['UNKNOWN', 'IN_FLIGHT'].includes(item.dispatchStatus))
      return {
        label: 'Resultado incierto',
        tone: 'warning',
        icon: 'unknown',
      } as const;
    return {
      label: 'Verificando pago',
      tone: 'warning',
      icon: 'pending',
    } as const;
  }
  if (item.status === 'DECLINED')
    return { label: 'Rechazada', tone: 'error', icon: 'declined' } as const;
  if (item.status === 'VOIDED')
    return { label: 'Anulada', tone: 'error', icon: 'declined' } as const;
  if (item.status === 'EXPIRED')
    return {
      label: 'Reserva vencida',
      tone: 'error',
      icon: 'declined',
    } as const;
  return { label: 'Error de pago', tone: 'error', icon: 'error' } as const;
}

function StatusIcon({
  icon,
}: {
  icon: ReturnType<typeof purchaseStatus>['icon'];
}) {
  if (icon === 'approved') return <CheckCircleOutlineIcon fontSize="inherit" />;
  if (icon === 'pending') return <HourglassTopIcon fontSize="inherit" />;
  if (icon === 'unknown') return <HelpOutlineIcon fontSize="inherit" />;
  if (icon === 'error') return <ErrorOutlineIcon fontSize="inherit" />;
  return <CancelOutlinedIcon fontSize="inherit" />;
}

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function Purchases({
  items,
  loaded,
  busy,
  error,
  onRetry,
  onOpen,
}: {
  items: PurchaseHistoryItem[];
  loaded: boolean;
  busy: boolean;
  error: string;
  onRetry: () => void;
  onOpen: (item: PurchaseHistoryItem) => void;
}) {
  return (
    <section className={styles.purchaseHistory} aria-labelledby="history-title">
      <h3 id="history-title">Mis compras</h3>
      <p className={styles.historyLimit}>
        Se muestran únicamente los intentos asociados a esta sesión invitada.
        Perder o vencer la cookie impide recuperarlos desde este navegador.
      </p>
      {busy && !loaded && (
        <div
          className={styles.historySkeletons}
          role="status"
          aria-label="Consultando tus compras"
        >
          {[0, 1, 2].map((position) => (
            <Skeleton key={position} variant="rounded" height={112} />
          ))}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button type="button" onClick={onRetry} disabled={busy}>
            Intentar de nuevo
          </button>
        </div>
      )}
      {!busy && loaded && !error && items.length === 0 && (
        <p className={styles.historyEmpty}>
          Aún no hay compras en esta sesión. Explora los productos para iniciar
          tu primera compra.
        </p>
      )}
      <div className={styles.historyList}>
        {items.map((item) => {
          const state = purchaseStatus(item);
          return (
            <article className={styles.historyItem} key={item.id}>
              <div>
                <span
                  className={`${styles.historyStatus} ${styles[state.tone]}`}
                >
                  <StatusIcon icon={state.icon} />
                  {state.label}
                </span>
                <h4>{item.productName}</h4>
                <p>
                  {item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'}{' '}
                  · {new Date(item.createdAt).toLocaleDateString('es-CO')}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Total</dt>
                  <dd>{money.format(item.totalCents / 100)}</dd>
                </div>
                <div>
                  <dt>Referencia</dt>
                  <dd>
                    <code>{item.reference}</code>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpen(item)}
              >
                Ver detalle
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
