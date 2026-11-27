import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import type { Product } from '../types';
import {
  categories,
  categoryImage,
  categoryNames,
  type Category,
} from '../storefront';
import styles from '../Storefront.module.css';

export function CategoryMosaic({
  products,
  onSelect,
}: {
  products: Product[];
  onSelect: (category: Category) => void;
}) {
  return (
    <section
      id="categorias"
      className={styles.categories}
      aria-labelledby="categories-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.kicker}>EXPLORA NODO</span>
          <h2 id="categories-title">Encuentra lo que buscas.</h2>
        </div>
        <p>Cinco formas de equipar tu día a día.</p>
      </div>
      <div className={styles.categoryGrid}>
        {categories.map(({ id, imageSku }, index) => {
          const count = products.filter(
            (product) => product.category === id,
          ).length;
          return (
            <button
              type="button"
              key={id}
              className={`${styles.categoryTile} ${index === 0 ? styles.categoryFeatured : ''}`}
              onClick={() => onSelect(id)}
              aria-label={`Ver ${categoryNames[id]}, ${count} ${count === 1 ? 'producto' : 'productos'}`}
            >
              <img
                src={categoryImage(imageSku)}
                alt=""
                width="420"
                height="420"
                loading="lazy"
              />
              <span className={styles.categoryCopy}>
                <small>
                  {count} {count === 1 ? 'producto' : 'productos'}
                </small>
                <strong>{categoryNames[id]}</strong>
              </span>
              <ArrowOutwardIcon
                className={styles.categoryArrow}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
