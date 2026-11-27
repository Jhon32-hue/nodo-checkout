import type { Summary as SummaryData, Product } from '../types';
import { money } from '../validation';
import { productImage } from '../storefront';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import styles from '../App.module.css';
export function Summary({
  summary: s,
  product,
  busy,
  onConfirm,
  onEdit,
  readOnly = false,
  canConfirm = true,
}: {
  summary: SummaryData;
  product?: Product;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  readOnly?: boolean;
  canConfirm?: boolean;
}) {
  return (
    <>
      <section
        className={styles.summarySection}
        aria-labelledby="summary-title"
      >
        <div className={styles.summaryHeading}>
          <div>
            <span>Último paso</span>
            <h3 id="summary-title">Revisa tu compra</h3>
          </div>
          <strong>{money(s.totalCents)}</strong>
        </div>
        <p className={styles.muted}>
          Confirma producto, cantidad e importes calculados por la tienda.
        </p>
      </section>
      <div className={styles.orderProduct} aria-label="Producto seleccionado">
        {product ? (
          <img
            src={productImage(product)}
            alt={product.name}
            width="88"
            height="88"
          />
        ) : (
          <span aria-hidden="true">▣</span>
        )}
        <div>
          <h3>{product?.name ?? 'Tu producto'}</h3>
          <p>
            {s.quantity} {s.quantity === 1 ? 'unidad' : 'unidades'} ×{' '}
            {money(s.unitPriceCents)} por unidad
          </p>
        </div>
      </div>
      <dl className={styles.totals}>
        <div>
          <dt>Subtotal</dt>
          <dd>{money(s.subtotalCents)}</dd>
        </div>
        <div>
          <dt>Tarifa base</dt>
          <dd>{money(s.baseFeeCents)}</dd>
        </div>
        <div>
          <dt>Entrega</dt>
          <dd>{money(s.deliveryFeeCents)}</dd>
        </div>
        <div className={styles.total}>
          <dt>Total a pagar</dt>
          <dd>
            {money(s.totalCents)} <small>COP</small>
          </dd>
        </div>
      </dl>
      {readOnly ? (
        <p className={styles.security}>
          Resumen histórico del intento. Consulta el estado antes de otra
          compra.
        </p>
      ) : (
        <>
          <Button
            className={styles.confirmButton}
            variant="contained"
            disabled={busy}
            onClick={onConfirm}
            endIcon={
              busy ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <ArrowForwardIcon />
              )
            }
          >
            {busy
              ? 'Procesando pago…'
              : canConfirm
                ? 'Confirmar y pagar'
                : 'Introducir tarjeta para pagar'}
          </Button>
          <Button variant="text" disabled={busy} onClick={onEdit}>
            Volver a tarjeta y entrega
          </Button>
          {busy && (
            <p
              className={styles.operationStatus}
              role="status"
              aria-live="polite"
            >
              Estamos procesando la operación. No cierres esta ventana ni pulses
              nuevamente.
            </p>
          )}
          <p className={styles.security}>
            Compra de prueba con datos ficticios.
          </p>
        </>
      )}
    </>
  );
}
