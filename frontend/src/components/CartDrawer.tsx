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
  products,
  busy,
  onClose,
  onExplore,
  onQuantity,
  onRemove,
  onCheckout,
}: {
  cart: Cart;
  products: Product[];
  busy: boolean;
  onClose: () => void;
  onExplore: () => void;
  onQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: (productId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const entries = cart.items.flatMap((item) => {
    const product = products.find(
      (candidate) => candidate.id === item.productId,
    );
    return product ? [{ item, product }] : [];
  });
  const subtotal = entries.reduce(
    (total, { item, product }) =>
      total + product.unitPriceCents * item.quantity,
    0,
  );

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
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.drawerHeader}>
        <div>
          <h2 id="cart-title">Tu carrito</h2>
          {!!entries.length && (
            <span>
              {entries.length} {entries.length === 1 ? 'producto' : 'productos'}
            </span>
          )}
        </div>
        <IconButton
          aria-label="Cerrar carrito"
          className={styles.iconButton}
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </div>
      <p aria-live="polite" className={styles.muted}>
        Tu carrito está actualizado. Cada producto se procesa por separado.
      </p>

      {!entries.length ? (
        <div className={styles.emptyCart}>
          <p>Tu carrito está vacío.</p>
          <button onClick={onExplore}>Ver productos</button>
        </div>
      ) : (
        <>
          <div className={styles.cartItems}>
            {entries.map(({ item, product }, index) => (
              <article className={styles.cartItem} key={product.id}>
                <div className={styles.cartLine}>
                  <div className={styles.cartThumb}>
                    {failed[product.id] ? (
                      <span aria-label={product.name}>↗</span>
                    ) : (
                      <img
                        src={productImage(product)}
                        alt=""
                        width="88"
                        height="88"
                        onError={() =>
                          setFailed((current) => ({
                            ...current,
                            [product.id]: true,
                          }))
                        }
                      />
                    )}
                  </div>
                  <div>
                    <span className={styles.cartOrder}>Compra {index + 1}</span>
                    <h3>{product.name}</h3>
                    <p>{money(product.unitPriceCents)} COP por unidad</p>
                  </div>
                </div>

                <div className={styles.cartControls}>
                  <QuantityStepper
                    quantity={item.quantity}
                    available={product.available}
                    onChange={(quantity) => onQuantity(product.id, quantity)}
                    label={`Cantidad de ${product.name} en carrito`}
                  />
                  <IconButton
                    color="error"
                    aria-label={`Eliminar ${product.name}`}
                    onClick={() => onRemove(product.id)}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </div>

                <div className={styles.cartItemFooter}>
                  <strong>
                    {money(product.unitPriceCents * item.quantity)} COP
                  </strong>
                  <Button
                    variant="contained"
                    startIcon={<CreditCardIcon />}
                    disabled={busy}
                    onClick={() => onCheckout(product.id)}
                  >
                    Comprar este producto
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className={styles.cartTotal}>
            <span>Subtotal estimado del carrito</span>
            <strong>{money(subtotal)} COP</strong>
          </div>
          <p className={styles.muted}>
            Cada producto se procesa como una compra independiente. La tarifa
            base, la entrega y el total definitivo se mostrarán en el resumen
            del servidor.
          </p>
        </>
      )}
    </dialog>
  );
}
