import { useState } from 'react';
import type { Product } from '../types';
import { money } from '../validation';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import { categoryNames, productImage } from '../storefront';
import styles from '../Storefront.module.css';
export function ProductCard({
  product: p,
  onOpen,
  onAdd,
}: {
  product: Product;
  onOpen: (id: string) => void;
  onAdd: (id: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <article
      className={`${styles.product} ${
        p.available === 0 ? styles.productSoldOut : ''
      }`}
    >
      <button
        className={styles.productImage}
        aria-label={'Ver detalle de ' + p.name}
        onClick={() => onOpen(p.id)}
      >
        {failed ? (
          <div className={styles.imageFallback} role="img" aria-label={p.name}>
            <span>↗</span>
            <small>{p.name}</small>
          </div>
        ) : (
          <img
            src={productImage(p)}
            alt={p.name}
            loading="lazy"
            width="400"
            height="400"
            onError={() => setFailed(true)}
          />
        )}
      </button>
      <div className={styles.productBody}>
        <span className={styles.eyebrow}>
          {p.category
            ? (categoryNames[p.category] ?? p.category)
            : 'Sin clasificar'}
        </span>
        <h3>
          <button className={styles.productTitle} onClick={() => onOpen(p.id)}>
            {p.name}
          </button>
        </h3>
        <span
          className={`${styles.stock} ${
            p.available === 0 ? styles.stockSoldOut : ''
          }`}
        >
          {p.available > 0 ? `${p.available} disponibles` : 'Agotado'}
        </span>
        <div className={styles.productBottom}>
          <strong className={styles.price}>
            {money(p.unitPriceCents)} <small>COP</small>
          </strong>
          <button
            type="button"
            className={styles.addButton}
            aria-label={`Agregar ${p.name} al carrito`}
            title="Agregar al carrito"
            disabled={p.available === 0}
            onClick={() => onAdd(p.id)}
          >
            <AddShoppingCartIcon fontSize="small" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
