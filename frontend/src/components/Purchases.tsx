import type { Product, PurchaseHistoryItem } from '../types';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import Skeleton from '@mui/material/Skeleton';
import { productImage } from '../storefront';
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

const date = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function Purchases({
  items,
  products,
  loaded,
  busy,
  error,
  onBack,
  onRetry,
  onOpen,
}: {
  items: PurchaseHistoryItem[];
  products: Product[];
  loaded: boolean;
  busy: boolean;
  error: string;
  onBack: () => void;
  onRetry: () => void;
  onOpen: (item: PurchaseHistoryItem) => void;
}) {
  return (
    <section className={styles.purchaseHistory} aria-labelledby="history-title">
      <button type="button" className={styles.historyBack} onClick={onBack}>
        <ArrowBackIcon fontSize="small" aria-hidden="true" />
        Volver a la tienda
      </button>

      <header className={styles.historyHero}>
        <div>
          <span className={styles.eyebrow}>TU ACTIVIDAD</span>
          <h1 id="history-title">Mis compras</h1>
          <p>
            Consulta el estado y los detalles de las compras realizadas en esta
            sesión invitada.
          </p>
        </div>
        <div
          className={styles.historyCount}
          aria-label={`${items.length} compras`}
        >
          <ReceiptLongOutlinedIcon aria-hidden="true" />
          <strong>{items.length}</strong>
          <span>{items.length === 1 ? 'compra' : 'compras'}</span>
        </div>
      </header>

      <p className={styles.historyLimit}>
        Este historial pertenece a la sesión de este navegador. Si la sesión
        vence, las compras permanecen registradas, pero ya no estarán
        disponibles desde aquí.
      </p>

      {busy && !loaded && (
        <div
          className={styles.historySkeletons}
          role="status"
          aria-label="Consultando tus compras"
        >
          {[0, 1, 2].map((position) => (
            <div className={styles.historySkeleton} key={position}>
              <Skeleton variant="rounded" width={132} height={132} />
              <div>
                <Skeleton width="35%" />
                <Skeleton width="72%" height={34} />
                <Skeleton width="52%" />
                <Skeleton width="42%" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className={styles.historyError} role="alert">
          <ErrorOutlineIcon aria-hidden="true" />
          <div>
            <strong>No pudimos consultar tus compras</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={onRetry} disabled={busy}>
            Intentar de nuevo
          </button>
        </div>
      )}

      {!busy && loaded && !error && items.length === 0 && (
        <div className={styles.historyEmpty}>
          <ReceiptLongOutlinedIcon aria-hidden="true" />
          <h2>Aún no hay compras en esta sesión</h2>
          <p>Explora los productos para iniciar tu primera compra.</p>
          <button type="button" onClick={onBack}>
            Ver productos
          </button>
        </div>
      )}

      <div className={styles.historyList}>
        {items.map((item) => {
          const state = purchaseStatus(item);
          const product = products.find(
            (candidate) => candidate.name === item.productName,
          );
          return (
            <article className={styles.historyItem} key={item.id}>
              <div className={styles.historyProductImage}>
                {product ? (
                  <img
                    src={productImage(product)}
                    alt=""
                    width="180"
                    height="180"
                    loading="lazy"
                  />
                ) : (
                  <Inventory2OutlinedIcon aria-hidden="true" />
                )}
              </div>

              <div className={styles.historyProductCopy}>
                <span
                  className={`${styles.historyStatus} ${styles[state.tone]}`}
                >
                  <StatusIcon icon={state.icon} />
                  {state.label}
                </span>
                <h2>{item.productName}</h2>
                <div className={styles.historyMeta}>
                  <span>
                    <Inventory2OutlinedIcon aria-hidden="true" />
                    {item.quantity}{' '}
                    {item.quantity === 1 ? 'unidad' : 'unidades'}
                  </span>
                  <span>
                    <CalendarTodayOutlinedIcon aria-hidden="true" />
                    {date.format(new Date(item.createdAt))}
                  </span>
                </div>
                <span className={styles.historyReference}>
                  Referencia <code>{item.reference}</code>
                </span>
              </div>

              <div className={styles.historySummary}>
                <span>Total</span>
                <strong>{money.format(item.totalCents / 100)}</strong>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(item)}
                >
                  Ver detalle
                  <ArrowForwardIcon fontSize="small" aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
