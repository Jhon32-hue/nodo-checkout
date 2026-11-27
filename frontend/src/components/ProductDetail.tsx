import { useState } from 'react';
import type { Product } from '../types';
import { money } from '../validation';
import { QuantityStepper } from './QuantityStepper';
import Button from '@mui/material/Button';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { categoryNames, productImage } from '../storefront';
import styles from '../App.module.css';

export function ProductDetail({
  product,
  disabled,
  onBack,
  onAdd,
  onBuy,
}: {
  product: Product;
  disabled: boolean;
  onBack: () => void;
  onAdd: (quantity: number) => void;
  onBuy: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [failed, setFailed] = useState(false);
  return (
    <section className={styles.detail} aria-labelledby="product-title">
      <Button variant="text" startIcon={<ArrowBackIcon />} onClick={onBack}>
        Volver al catálogo
      </Button>
      <div className={styles.detailGrid}>
        <div className={styles.detailImage}>
          {failed ? (
            <div
              className={styles.imageFallback}
              role="img"
              aria-label={product.name}
            >
              <span>↗</span>
              <small>{product.name}</small>
            </div>
          ) : (
            <img
              src={productImage(product)}
              alt={product.name}
              width="600"
              height="600"
              onError={() => setFailed(true)}
            />
          )}
        </div>
        <div className={styles.detailInfo}>
          <span className={styles.eyebrow}>
            {product.category
              ? (categoryNames[product.category] ?? product.category)
              : 'Sin clasificar'}
          </span>
          <h1 id="product-title" tabIndex={-1}>
            {product.name}
          </h1>
          <p>{product.description}</p>
          <strong className={styles.price}>
            {money(product.unitPriceCents)} <small>COP por unidad</small>
          </strong>
          <p>
            {product.available > 0
              ? `${product.available} unidades disponibles`
              : 'Agotado'}
          </p>
          {product.available > 0 && (
            <>
              <QuantityStepper
                quantity={quantity}
                available={product.available}
                onChange={setQuantity}
                label="Cantidad del producto"
              />
              <div className={styles.detailActions}>
                <Button
                  disabled={disabled}
                  variant="outlined"
                  startIcon={<AddShoppingCartIcon />}
                  onClick={() => onAdd(quantity)}
                >
                  Agregar al carrito
                </Button>
                <Button
                  disabled={disabled}
                  variant="contained"
                  startIcon={<CreditCardIcon />}
                  onClick={() => onBuy(quantity)}
                >
                  Pagar con tarjeta de crédito
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
