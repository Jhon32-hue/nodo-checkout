import { useEffect, useRef, useState } from 'react';
import type { Product } from '../types';
import { productImage } from '../storefront';
import type { Cart } from '../state/cart';
import { money } from '../validation';
import { QuantityStepper } from './QuantityStepper';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import CloseIcon from '@mui/icons-material/Close';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import styles from '../App.module.css';

export function CartDrawer({
  cart,
  product,
  busy,
  onClose,
  onExplore,
  onQuantity,
  onRemove,
  onCheckout,
}: {
  cart: Cart | null;
  product?: Product;
  busy: boolean;
  onClose: () => void;
  onExplore: () => void;
  onQuantity: (n: number) => void;
  onRemove: () => void;
  onCheckout: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('button')?.focus();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.cartDrawer}
      aria-labelledby="cart-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={styles.drawerHeader}>
        <h2 id="cart-title">Tu carrito</h2>
        <IconButton
          aria-label="Cerrar carrito"
          className={styles.iconButton}
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </div>
      {!cart || !product ? (
        <div className={styles.emptyCart}>
          <p>Tu carrito está vacío.</p>
          <button onClick={onExplore}>Ver productos</button>
        </div>
      ) : (
        <>
          <div className={styles.cartLine}>
            <div className={styles.cartThumb}>
              {failed ? (
                <span aria-label={product.name}>↗</span>
              ) : (
                <img
                  src={productImage(product)}
                  alt=""
                  width="88"
                  height="88"
                  onError={() => setFailed(true)}
                />
              )}
            </div>
            <div>
              <h3>{product.name}</h3>
              <p>{money(product.unitPriceCents)} COP por unidad</p>
              <p>{product.available} disponibles</p>
            </div>
          </div>
          <QuantityStepper
            quantity={cart.quantity}
            available={product.available}
            onChange={onQuantity}
            label="Cantidad en carrito"
          />
          <Button
            variant="text"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={onRemove}
          >
            Eliminar producto
          </Button>
          <div className={styles.cartTotal}>
            <span>Subtotal del producto</span>
            <strong>{money(product.unitPriceCents * cart.quantity)} COP</strong>
          </div>
          <p className={styles.muted}>
            La tarifa base, la entrega y el total definitivo se mostrarán en el
            resumen del servidor antes de confirmar.
          </p>
          <Button
            variant="contained"
            fullWidth
            startIcon={<CreditCardIcon />}
            disabled={busy}
            onClick={onCheckout}
          >
            Pagar con tarjeta de crédito
          </Button>
        </>
      )}
    </dialog>
  );
}
