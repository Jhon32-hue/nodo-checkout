import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Button from '@mui/material/Button';
import type { Product } from '../types';
import { productImage } from '../storefront';
import { money } from '../validation';
import styles from '../App.module.css';

export function CheckoutProductPreview({
  product,
  quantity,
  onReturn,
}: {
  product: Product;
  quantity: number;
  onReturn: () => void;
}) {
  return (
    <section
      className={styles.checkoutProduct}
      aria-labelledby="checkout-product-title"
    >
      <img src={productImage(product)} alt="" width="160" height="160" />
      <div>
        <span className={styles.eyebrow}>PRODUCTO DE ESTA COMPRA</span>
        <h3 id="checkout-product-title">{product.name}</h3>
        <p>{product.description}</p>
        <dl>
          <div>
            <dt>Cantidad</dt>
            <dd>{quantity}</dd>
          </div>
          <div>
            <dt>Precio unitario</dt>
            <dd>{money(product.unitPriceCents)} COP</dd>
          </div>
          <div>
            <dt>Disponibles</dt>
            <dd>{product.available}</dd>
          </div>
        </dl>
        <Button
          variant="contained"
          startIcon={<ArrowBackIcon />}
          onClick={onReturn}
        >
          Volver al checkout
        </Button>
      </div>
    </section>
  );
}
