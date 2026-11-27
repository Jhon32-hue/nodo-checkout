import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import { actions, type State } from './state/store';
import type { Flow } from './state/flow';
import { ProductCard } from './components/ProductCard';
import { CategoryMosaic } from './components/CategoryMosaic';
import { ProductDetail } from './components/ProductDetail';
import { CartDrawer } from './components/CartDrawer';
import { Dialog } from './components/Dialog';
import { DetailsForm } from './components/DetailsForm';
import type { DetailsDraft } from './components/DetailsForm';
import { Summary } from './components/Summary';
import { Result } from './components/Result';
import { CheckoutProgress } from './components/CheckoutProgress';
import { Purchases } from './components/Purchases';
import { CheckoutProductPreview } from './components/CheckoutProductPreview';
import { recoveryNotice } from './state/recovery';
import {
  addCartItem,
  cartUnits,
  removeCartItem,
  updateCartItem,
} from './state/cart';
import styles from './App.module.css';
import shopStyles from './Storefront.module.css';
import {
  categoryNames,
  filterProducts,
  type CategoryFilter,
  type Category,
} from './storefront';
export function App({ flow }: { flow: Flow }) {
  const dispatch = useDispatch();
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [checkoutProductOpen, setCheckoutProductOpen] = useState(false);
  const [draft, setDraft] = useState<
    (DetailsDraft & { checkoutId: string }) | null
  >(null);
  const products = useSelector((s: State) => s.products);
  const checkout = useSelector((s: State) => s.checkout);
  const summary = useSelector((s: State) => s.summary);
  const attempt = useSelector((s: State) => s.attempt);
  const step = useSelector((s: State) => s.step);
  const busy = useSelector((s: State) => s.busy);
  const error = useSelector((s: State) => s.error);
  const cart = useSelector((s: State) => s.cart);
  const selectedProductId = useSelector((s: State) => s.selectedProductId);
  const cartOpen = useSelector((s: State) => s.cartOpen);
  const notice = useSelector((s: State) => s.notice);
  const purchases = useSelector((s: State) => s.purchases);
  const historyLoaded = useSelector((s: State) => s.historyLoaded);
  const historyError = useSelector((s: State) => s.historyError);
  const recoveryWarning = useSelector((s: State) => s.recoveryWarning);
  const approvedTransition = useSelector((s: State) => s.approvedTransition);
  const s = { products, checkout, summary, attempt, step, busy, error };
  useEffect(() => {
    void flow.initialize();
  }, [flow]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => dispatch(actions.notice('')), 3500);
    return () => window.clearTimeout(timer);
  }, [notice, dispatch]);
  useEffect(() => {
    if (selectedProductId) {
      window.scrollTo(0, 0);
      document.getElementById('product-title')?.focus();
    }
  }, [selectedProductId]);
  useEffect(() => {
    if (!approvedTransition) return;
    let cancelled = false;
    let timer: number | undefined;
    void flow.completeApprovedTransition().then(() => {
      if (cancelled) return;
      setDraft(null);
      setCheckoutDialogOpen(false);
      timer = window.setTimeout(() => flow.finishApprovedTransition(), 2800);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [approvedTransition, flow]);
  const checkoutDraft: DetailsDraft | undefined =
    draft && draft.checkoutId === checkout?.id
      ? draft
      : checkout
        ? (flow.checkoutDraft(checkout.id) ?? undefined)
        : undefined;
  const product = s.products.find((p) => p.id === s.checkout?.productId);
  const selected = s.products.find((p) => p.id === selectedProductId);
  const cartCount = cartUnits(cart);
  const pending = s.attempt?.status === 'PENDING';
  const normalizedSearch = search.trim().toLocaleLowerCase('es-CO');
  const visibleProducts = filterProducts(s.products, category).filter(
    (item) =>
      !normalizedSearch ||
      [item.name, item.description, item.category ?? ''].some((value) =>
        value.toLocaleLowerCase('es-CO').includes(normalizedSearch),
      ),
  );
  const recovery = recoveryNotice(s.checkout, s.attempt);
  const navigateCheckout = (target: State['step']) => {
    if (target === 'catalog' && s.checkout) {
      setCheckoutProductOpen(true);
      return;
    }
    setCheckoutProductOpen(false);
    setCheckoutDialogOpen(true);
    flow.navigate(target);
  };
  const addCart = (productId: string, quantity: number) => {
    const product = s.products.find((item) => item.id === productId);
    const limit = Math.min(product?.available ?? 0, 99);
    const current = cart.items.find((item) => item.productId === productId);
    if ((current?.quantity ?? 0) >= limit) {
      dispatch(
        actions.notice(
          'Ya tienes todas las unidades disponibles en el carrito.',
        ),
      );
      return;
    }
    dispatch(
      actions.cart(addCartItem(cart, { productId, quantity }, s.products)),
    );
    dispatch(actions.notice('Producto agregado al carrito.'));
  };
  const goTo = (section: 'inicio' | 'categorias' | 'catalogo') => {
    dispatch(actions.selectedProduct(null));
    dispatch(actions.cartOpen(false));
    setMenuOpen(false);
    window.requestAnimationFrame(() =>
      document.getElementById(section)?.scrollIntoView(),
    );
  };
  const selectCategory = (selectedCategory: Category) => {
    setCategory(selectedCategory);
    goTo('catalogo');
  };
  return (
    <>
      <header
        className={shopStyles.header}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMenuOpen(false);
        }}
      >
        <a
          href="#inicio"
          className={shopStyles.logo}
          onClick={() => goTo('inicio')}
        >
          nodo<span className={shopStyles.logoDot}>.</span>
        </a>
        <nav
          id="shop-navigation"
          className={`${shopStyles.nav} ${menuOpen ? shopStyles.navOpen : ''}`}
          aria-label="Navegación principal"
        >
          <a href="#inicio" onClick={() => goTo('inicio')}>
            Inicio
          </a>
          <a href="#categorias" onClick={() => goTo('categorias')}>
            Categorías
          </a>
          <a href="#catalogo" onClick={() => goTo('catalogo')}>
            Productos
          </a>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setHistoryOpen(true);
              void flow.history();
            }}
          >
            Mis compras
          </button>
        </nav>
        <button
          type="button"
          className={shopStyles.menuToggle}
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={menuOpen}
          aria-controls="shop-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
        <label className={shopStyles.search}>
          <SearchIcon fontSize="small" aria-hidden="true" />
          <span className={shopStyles.srOnly}>Buscar productos</span>
          <input
            type="search"
            value={search}
            placeholder="Buscar productos"
            aria-label="Buscar productos"
            onChange={(event) => {
              setSearch(event.target.value);
              if (event.target.value.trim()) goTo('catalogo');
            }}
          />
        </label>
        <Button
          variant="outlined"
          startIcon={<ShoppingCartIcon />}
          className={shopStyles.cartTrigger}
          aria-label={`Abrir carrito, ${cartCount} unidades`}
          onClick={() => dispatch(actions.cartOpen(true))}
        >
          <span className={shopStyles.cartText}>Carrito</span>
          <span className={shopStyles.cartCount}>{cartCount}</span>
        </Button>
      </header>
      <main className={historyOpen ? styles.historyPageShell : undefined}>
        {historyOpen ? (
          <Purchases
            items={purchases}
            products={products}
            loaded={historyLoaded}
            busy={busy}
            error={historyError}
            onBack={() => setHistoryOpen(false)}
            onRetry={() => void flow.history()}
          />
        ) : (
          <>
            {!selected && s.step !== 'result' && (
              <section id="inicio" className={shopStyles.hero}>
                <div className={shopStyles.heroCopy}>
                  <span className={shopStyles.heroEyebrow}>
                    TECNOLOGÍA PARA TU DÍA A DÍA
                  </span>
                  <h1>
                    Conecta con lo que importa<span>.</span>
                  </h1>
                  <p>
                    Explora audio, accesorios y herramientas para tu espacio.
                  </p>
                  <a
                    href="#catalogo"
                    className={shopStyles.heroCta}
                    onClick={() => goTo('catalogo')}
                  >
                    Ver productos{' '}
                    <ArrowForwardIcon fontSize="small" aria-hidden="true" />
                  </a>
                </div>
                <img
                  className={shopStyles.heroBanner}
                  src="/images/store/banner.jpg"
                  alt=""
                  width="3038"
                  height="1375"
                  fetchPriority="high"
                  aria-hidden="true"
                />
              </section>
            )}
            {!selected && s.step !== 'result' && (
              <CategoryMosaic products={s.products} onSelect={selectCategory} />
            )}
            <Snackbar
              open={!!notice}
              message={notice}
              autoHideDuration={3500}
              onClose={(_, reason) => {
                if (reason !== 'clickaway') dispatch(actions.notice(''));
              }}
              slotProps={{ content: { role: 'status' } }}
            />
            {recoveryWarning && (
              <div className={styles.error} role="alert">
                {recoveryWarning}
                {!!cart.items.length && (
                  <button
                    type="button"
                    className={styles.textButton}
                    disabled={s.busy}
                    onClick={() => {
                      const first = cart.items[0];
                      if (first)
                        void flow.begin(first.productId, first.quantity);
                    }}
                  >
                    Iniciar una nueva compra
                  </button>
                )}
              </div>
            )}
            {s.error && (
              <div className={styles.error} role="alert">
                {s.error}
                {s.checkout && (
                  <button
                    className={styles.textButton}
                    disabled={s.busy}
                    onClick={() => void flow.recover()}
                  >
                    Recuperar estado de mi compra
                  </button>
                )}
              </div>
            )}
            {s.step === 'result' && s.attempt ? (
              <section className={styles.resultPanel}>
                <CheckoutProgress
                  flow={flow}
                  current={s.step}
                  busy={s.busy}
                  onNavigate={navigateCheckout}
                />
                <Result attempt={s.attempt} flow={flow} busy={s.busy} />
              </section>
            ) : selected ? (
              <>
                {s.checkout?.productId === selected.id && (
                  <CheckoutProgress
                    flow={flow}
                    current={s.step}
                    busy={s.busy}
                    onNavigate={navigateCheckout}
                  />
                )}
                <ProductDetail
                  key={selected.id}
                  product={selected}
                  disabled={s.busy || pending}
                  onBack={() => goTo('catalogo')}
                  onAdd={(n) => addCart(selected.id, n)}
                  onBuy={(n) => {
                    dispatch(actions.selectedProduct(null));
                    setCheckoutDialogOpen(true);
                    void flow.begin(selected.id, n);
                  }}
                />
              </>
            ) : (
              <section id="catalogo" className={shopStyles.catalog}>
                <div className={shopStyles.sectionHeading}>
                  <div>
                    <span className={shopStyles.kicker}>SELECCIÓN NODO</span>
                    <h2>
                      {category === 'all'
                        ? 'Todos los productos'
                        : categoryNames[category]}
                    </h2>
                  </div>
                  <span>
                    {visibleProducts.length}{' '}
                    {visibleProducts.length === 1 ? 'producto' : 'productos'}
                  </span>
                </div>
                <div
                  className={shopStyles.filters}
                  role="group"
                  aria-label="Filtrar productos por categoría"
                >
                  {(
                    [
                      'all',
                      'audio',
                      'computacion',
                      'accesorios',
                      'almacenamiento',
                      'hogar-inteligente',
                    ] as const
                  ).map((filter) => (
                    <button
                      type="button"
                      key={filter}
                      className={
                        category === filter ? shopStyles.filterActive : ''
                      }
                      aria-pressed={category === filter}
                      onClick={() => setCategory(filter)}
                    >
                      {filter === 'all' ? 'Todos' : categoryNames[filter]}
                    </button>
                  ))}
                </div>
                {recovery && (
                  <div
                    className={`${shopStyles.resume} ${pending ? shopStyles.resumePending : ''}`}
                  >
                    <span>{recovery.message}</span>
                    <div className={shopStyles.resumeActions}>
                      <button
                        disabled={s.busy}
                        onClick={() => {
                          setCheckoutDialogOpen(true);
                          void flow.recover();
                        }}
                      >
                        {recovery.action === 'status'
                          ? 'Consultar estado'
                          : 'Continuar'}
                      </button>
                      {recovery.canDiscard && (
                        <button
                          disabled={s.busy}
                          onClick={() => {
                            if (flow.discardLocalDraft()) {
                              setDraft(null);
                              dispatch(
                                actions.notice('Borrador local descartado.'),
                              );
                            }
                          }}
                        >
                          Descartar borrador local
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {s.busy && s.products.length === 0 && (
                  <div
                    role="status"
                    aria-label="Consultando la colección"
                    className={shopStyles.skeletonGrid}
                  >
                    {[1, 2, 3].map((n) => (
                      <div key={n} className={shopStyles.skeleton} />
                    ))}
                  </div>
                )}
                <div className={shopStyles.grid}>
                  {visibleProducts.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onOpen={(id) => dispatch(actions.selectedProduct(id))}
                      onAdd={(id) => addCart(id, 1)}
                    />
                  ))}
                </div>
                {!s.busy &&
                  s.products.length > 0 &&
                  visibleProducts.length === 0 && (
                    <p className={shopStyles.emptyFilter}>
                      No encontramos productos con estos filtros.{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setCategory('all');
                          setSearch('');
                        }}
                      >
                        Limpiar filtros
                      </button>
                    </p>
                  )}
                {!s.busy && s.products.length === 0 && (
                  <button onClick={() => void flow.initialize()}>
                    Volver a consultar catálogo
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <footer className={shopStyles.footer}>
        <div className={shopStyles.footerBrand}>
          <span className={shopStyles.logo}>
            nodo<span className={shopStyles.logoDot}>.</span>
          </span>
          <p>Tecnología cotidiana, elegida con intención.</p>
        </div>
        <div className={shopStyles.footerCta}>
          <span>Encuentra tu próximo esencial tecnológico.</span>
          <a href="#catalogo" onClick={() => goTo('catalogo')}>
            Explorar productos
            <ArrowForwardIcon fontSize="small" aria-hidden="true" />
          </a>
        </div>
        <small>Una compra a la vez · Hecho para explorar</small>
      </footer>
      {cartOpen && (
        <CartDrawer
          cart={cart}
          products={s.products}
          busy={s.busy || pending}
          onClose={() => dispatch(actions.cartOpen(false))}
          onExplore={() => goTo('catalogo')}
          onQuantity={(productId, quantity) =>
            dispatch(actions.cart(updateCartItem(cart, productId, quantity)))
          }
          onRemove={(productId) => {
            const discarded =
              s.checkout?.productId === productId && flow.discardLocalDraft();
            if (discarded) setDraft(null);
            dispatch(actions.cart(removeCartItem(cart, productId)));
            dispatch(
              actions.notice(
                discarded
                  ? 'Producto eliminado y borrador local descartado.'
                  : s.attempt?.status === 'PENDING'
                    ? 'Producto eliminado. El pago sigue en verificación y permanece recuperable.'
                    : 'Producto eliminado del carrito.',
              ),
            );
          }}
          onCheckout={(productId) => {
            const item = cart.items.find(
              (candidate) => candidate.productId === productId,
            );
            if (item) {
              dispatch(actions.cartOpen(false));
              setCheckoutDialogOpen(true);
              setCheckoutProductOpen(false);
              void flow.begin(item.productId, item.quantity);
            }
          }}
        />
      )}
      {checkoutDialogOpen &&
        (s.step === 'details' || s.step === 'summary') &&
        s.checkout && (
          <Dialog
            title={
              checkoutProductOpen
                ? 'Producto de la compra'
                : s.step === 'details'
                  ? 'Pagar con tarjeta'
                  : 'Resumen de compra'
            }
            error={s.error}
            onClose={() => {
              if (!s.busy) {
                flow.close();
                setCheckoutDialogOpen(false);
                setCheckoutProductOpen(false);
                setDraft((current) =>
                  current
                    ? {
                        checkoutId: current.checkoutId,
                        buyer: current.buyer,
                        delivery: current.delivery,
                      }
                    : null,
                );
              }
            }}
          >
            <CheckoutProgress
              flow={flow}
              current={checkoutProductOpen ? 'catalog' : s.step}
              busy={s.busy}
              onNavigate={navigateCheckout}
            />
            {s.error && !checkoutProductOpen && (
              <p className={styles.error} role="alert" tabIndex={-1}>
                {s.error}
              </p>
            )}
            {checkoutProductOpen && product ? (
              <CheckoutProductPreview
                product={product}
                quantity={s.checkout.quantity}
                onReturn={() => setCheckoutProductOpen(false)}
              />
            ) : s.step === 'details' ? (
              <DetailsForm
                key={s.checkout.id}
                checkout={s.checkout}
                flow={flow}
                busy={s.busy}
                draft={checkoutDraft}
                onDraftChange={(value) => {
                  setDraft({ checkoutId: s.checkout!.id, ...value });
                  flow.invalidateSummary();
                }}
              />
            ) : (
              s.summary && (
                <Summary
                  summary={s.summary}
                  product={product}
                  busy={s.busy}
                  onConfirm={() => void flow.confirm()}
                  onEdit={() => flow.edit()}
                  readOnly={
                    !!s.attempt && s.attempt.dispatchStatus !== 'NOT_SENT'
                  }
                  canConfirm={flow.canConfirm()}
                  cardNumber={checkoutDraft?.card?.number}
                />
              )
            )}
          </Dialog>
        )}
    </>
  );
}
