import type { PurchaseHistoryItem } from '../types';
import styles from '../App.module.css';

export function purchaseStatus(item: PurchaseHistoryItem) {
  if (item.status === 'APPROVED')
    return { label: 'Aprobada', tone: 'success' } as const;
  if (item.status === 'PENDING') {
    if (['UNKNOWN', 'IN_FLIGHT'].includes(item.dispatchStatus))
      return { label: 'Resultado incierto', tone: 'warning' } as const;
    return { label: 'Pendiente', tone: 'warning' } as const;
  }
  return { label: 'No aprobada', tone: 'error' } as const;
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
      {busy && !loaded && <p role="status">Consultando tus compras…</p>}
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
          Aún no hay compras en esta sesión.
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
