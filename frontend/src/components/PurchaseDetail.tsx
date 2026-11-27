import { useEffect, useState } from 'react';
import MuiDialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import BlockIcon from '@mui/icons-material/Block';
import { api } from '../services/api';
import { message, money } from '../validation';
import type { Attempt, Checkout, Product, PurchaseHistoryItem } from '../types';
import { productImage } from '../storefront';
import styles from '../App.module.css';

const statusText = (attempt: Attempt) => {
  if (attempt.status === 'APPROVED') return 'Compra confirmada.';
  if (attempt.status === 'DECLINED') return 'El pago fue rechazado.';
  if (attempt.status === 'ERROR') return 'No pudimos completar el pago.';
  if (attempt.status === 'VOIDED') return 'El pago fue anulado.';
  if (attempt.status === 'EXPIRED') return 'La reserva venció.';
  return attempt.dispatchStatus === 'UNKNOWN'
    ? 'Aún no pudimos confirmar el resultado.'
    : 'Estamos verificando el pago.';
};

export function PurchaseDetail({
  item,
  products,
  onClose,
}: {
  item: PurchaseHistoryItem;
  products: Product[];
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    checkout: Checkout;
    attempt: Attempt;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([api.checkout(item.checkoutId), api.attempt(item.id)])
      .then(([checkout, attempt]) => {
        if (active) setData({ checkout, attempt });
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [item.checkoutId, item.id, retry]);
  const product = products.find((p) => p.id === data?.checkout.productId);
  const summary = data?.attempt.summary;
  const delivery = data?.checkout.delivery;
  const status = data?.attempt.status;
  const tone =
    status === 'APPROVED'
      ? 'success'
      : status === 'PENDING'
        ? 'warning'
        : status === 'VOIDED'
          ? 'neutral'
          : 'error';
  const sync = async () => {
    if (busy || !data) return;
    setBusy(true);
    setError('');
    try {
      const attempt = await api.sync(item.id);
      setData({ ...data, attempt });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <MuiDialog
      open
      onClose={onClose}
      fullWidth
      maxWidth={false}
      aria-labelledby="purchase-detail-title"
      slotProps={{
        paper: {
          sx: {
            width: 'min(660px, calc(100% - 24px))',
            maxHeight: { xs: '94dvh', sm: '88dvh' },
            m: 1.5,
            borderRadius: 3,
            paddingBottom: 'env(safe-area-inset-bottom)',
          },
        },
      }}
    >
      <DialogTitle id="purchase-detail-title">Detalle de tu compra</DialogTitle>
      <DialogContent
        dividers
        className={styles.purchaseDetail}
        aria-busy={busy}
      >
        {busy && !data && (
          <div role="status" aria-label="Consultando detalle">
            <Skeleton height={120} />
            <Skeleton height={48} />
            <Skeleton height={120} />
          </div>
        )}
        {error && (
          <div role="alert">
            {error}
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                setRetry((n) => n + 1);
              }}
            >
              Intentar de nuevo
            </Button>
          </div>
        )}
        {data && (
          <>
            <p className={`${styles.detailStatus} ${styles[tone]}`}>
              <span aria-hidden="true">
                {status === 'APPROVED' ? (
                  <CheckCircleOutlineIcon />
                ) : status === 'PENDING' ? (
                  <HourglassTopIcon />
                ) : status === 'VOIDED' ? (
                  <BlockIcon />
                ) : (
                  <ErrorOutlineIcon />
                )}
              </span>
              {statusText(data.attempt)}
            </p>
            <section className={styles.purchaseDetailProduct}>
              {product && (
                <img
                  src={productImage(product)}
                  alt=""
                  width="120"
                  height="120"
                />
              )}
              <div>
                <h2>{item.productName}</h2>
                <p>{summary?.quantity ?? item.quantity} unidades</p>
                {summary && (
                  <p>Precio unitario: {money(summary.unitPriceCents)} COP</p>
                )}
              </div>
            </section>
            {summary && (
              <section>
                <h3>Resumen</h3>
                <dl className={styles.purchaseAmounts}>
                  {(
                    [
                      ['Subtotal', summary.subtotalCents],
                      ['Tarifa base', summary.baseFeeCents],
                      ['Entrega', summary.deliveryFeeCents],
                      ['Total COP', summary.totalCents],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{money(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <section>
              <h3>Pago</h3>
              <p>Tarjeta de crédito</p>
            </section>
            {delivery && (
              <section>
                <h3>Entrega</h3>
                <address>
                  {delivery.recipientName}
                  <br />
                  {delivery.addressLine1}
                  <br />
                  {delivery.addressLine2 && (
                    <>
                      {delivery.addressLine2}
                      <br />
                    </>
                  )}
                  {delivery.city}, {delivery.region}
                  <br />
                  {delivery.postalCode && (
                    <>
                      {delivery.postalCode}
                      <br />
                    </>
                  )}
                  {delivery.phone}
                </address>
              </section>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, flexWrap: 'wrap' }}>
        {data?.attempt.status === 'PENDING' &&
          data.attempt.dispatchStatus !== 'NOT_SENT' && (
            <Button disabled={busy} onClick={() => void sync()}>
              {busy ? 'Consultando…' : 'Consultar estado'}
            </Button>
          )}
        <Button onClick={onClose}>Cerrar detalle</Button>
      </DialogActions>
    </MuiDialog>
  );
}
