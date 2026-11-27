import { actions, type Store } from './store';
import { loadProgress, saveProgress, type Progress } from './progress';
import { ApiError, type Api } from '../services/api';
import type {
  Buyer,
  Delivery,
  Card,
  Config,
  Consent,
  PurchaseHistoryItem,
  Step,
} from '../types';
import { message, quantityValid } from '../validation';
export class Flow {
  private locked = false;
  private progress: Progress;
  private token: string | null = null;
  private card: Card | null = null;
  private config: Config | null = null;
  private consent: Consent = { policy: false, personal: false };
  constructor(
    private store: Store,
    private api: Api,
    private tokenize: (card: Card, config: Config) => Promise<string>,
    private storage: Storage = window.localStorage,
  ) {
    this.progress = loadProgress(storage);
  }
  private save(step: Step) {
    this.progress = { ...this.progress, step };
    saveProgress(this.progress, this.storage);
    this.store.dispatch(actions.step(step));
  }
  private async run(work: () => Promise<void>) {
    if (this.locked) return;
    this.locked = true;
    this.store.dispatch(actions.busy(true));
    this.store.dispatch(actions.error(''));
    try {
      await work();
    } catch (error) {
      this.store.dispatch(actions.error(message(error)));
    } finally {
      this.locked = false;
      this.store.dispatch(actions.busy(false));
    }
  }
  private forgetCard() {
    this.token = null;
    this.card = null;
    this.config = null;
    this.consent = { policy: false, personal: false };
  }
  navigation(target: Step): {
    enabled: boolean;
    reason: string;
    completed: boolean;
  } {
    const s = this.store.getState();
    const canEdit =
      !s.attempt ||
      (s.attempt.status === 'PENDING' &&
        s.attempt.dispatchStatus === 'NOT_SENT' &&
        !s.attempt.reservationExpired);
    if (target === 'catalog')
      return { enabled: true, reason: '', completed: !!s.checkout };
    if (target === 'details')
      return {
        enabled: !!s.checkout && canEdit,
        reason: !s.checkout
          ? 'Selecciona un producto para continuar.'
          : 'Este intento ya se envió o terminó. Consulta el estado antes de otra compra.',
        completed: !!s.summary,
      };
    if (target === 'summary')
      return {
        enabled: !!s.summary,
        reason: 'Completa los datos y consulta el resumen del servidor.',
        completed: !!s.attempt && s.attempt.status !== 'PENDING',
      };
    return {
      enabled: !!s.attempt,
      reason: 'El resultado estará disponible cuando se inicie el pago.',
      completed: !!s.attempt && s.attempt.status !== 'PENDING',
    };
  }
  navigate(target: Step) {
    if (this.locked || !this.navigation(target).enabled) return;
    this.save(target);
  }
  canConfirm() {
    return !!this.card && !!this.config;
  }
  invalidateSummary() {
    if (
      this.locked ||
      !this.store.getState().summary ||
      this.store.getState().attempt
    )
      return;
    this.token = null;
    this.card = null;
    this.consent = { policy: false, personal: false };
    this.store.dispatch(actions.summary(null));
  }
  async initialize() {
    await this.run(async () => {
      let catalogError: unknown;
      try {
        this.store.dispatch(actions.products(await this.api.products()));
      } catch (error) {
        catalogError = error;
      }
      if (this.progress.checkoutId) {
        await this.api.session();
        await this.restore();
        this.save('catalog');
      }
      if (catalogError) throw catalogError;
    });
  }
  private async restore() {
    const c = await this.api.checkout(this.progress.checkoutId!);
    this.store.dispatch(actions.checkout(c));
    const id =
      this.progress.transactionId ??
      c.activeTransactionId ??
      c.latestTransactionId;
    if (id) {
      const t = await this.api.attempt(id);
      this.progress.transactionId = id;
      this.store.dispatch(actions.attempt(t));
      this.store.dispatch(actions.summary(t.summary ?? null));
      this.save(
        t.status === 'PENDING' &&
          t.dispatchStatus === 'NOT_SENT' &&
          !t.reservationExpired
          ? 'details'
          : 'result',
      );
    } else {
      this.store.dispatch(
        actions.summary(await this.api.summary(c.id).catch(() => null)),
      );
      this.save('details');
    }
  }
  async begin(productId: string, quantity: number) {
    await this.run(async () => {
      const s = this.store.getState();
      if (this.progress.checkoutId && !s.checkout) {
        await this.api.session();
        await this.restore();
        return;
      }
      if (s.attempt?.status === 'PENDING') {
        this.save('result');
        return;
      }
      const product = s.products.find((p) => p.id === productId);
      if (!product || !quantityValid(quantity, product.available))
        throw new ApiError('INSUFFICIENT_STOCK');
      await this.api.session();
      this.forgetCard();
      const c =
        s.checkout?.status === 'DRAFT' &&
        s.checkout.productId === productId &&
        s.checkout.quantity === quantity &&
        !s.attempt
          ? s.checkout
          : await this.api.createCheckout(productId, quantity);
      this.progress = { checkoutId: c.id, step: 'details' };
      this.store.dispatch(actions.attempt(null));
      this.store.dispatch(actions.checkout(c));
      this.store.dispatch(actions.summary(null));
      this.save('details');
    });
  }
  async configuration() {
    const config = await this.api.config();
    this.config = config;
    return config;
  }
  async details(
    buyer: Buyer,
    delivery: Delivery,
    card: Card,
    consent: Consent,
  ) {
    await this.run(async () => {
      const c = this.store.getState().checkout;
      if (!c) throw new ApiError('RESOURCE_NOT_FOUND');
      if (!consent.policy || !consent.personal)
        throw new ApiError('INVALID_ACCEPTANCE');
      if (c.status === 'DRAFT')
        this.store.dispatch(
          actions.checkout(await this.api.patch(c.id, buyer, delivery)),
        );
      const config = this.config;
      if (!config) throw new ApiError('GATEWAY_UNAVAILABLE');
      this.card = card;
      this.consent = consent;
      this.store.dispatch(actions.summary(await this.api.summary(c.id)));
      this.save('summary');
    });
  }
  async confirm() {
    await this.run(async () => {
      const s = this.store.getState();
      if (
        s.attempt &&
        (s.attempt.status !== 'PENDING' ||
          s.attempt.dispatchStatus !== 'NOT_SENT')
      ) {
        this.save('result');
        return;
      }
      if (!s.checkout || !s.summary || !this.card || !this.config) {
        this.forgetCard();
        this.save('details');
        return;
      }
      this.progress.idempotencyKey ??= crypto.randomUUID();
      this.save('summary');
      this.token = await this.tokenize(this.card, this.config);
      let t = s.attempt;
      if (t && (t.status !== 'PENDING' || t.dispatchStatus !== 'NOT_SENT')) {
        this.save('result');
        return;
      }
      try {
        if (!t)
          t = await this.api.createAttempt(
            s.checkout.id,
            s.summary,
            this.progress.idempotencyKey,
          );
      } catch (error) {
        if (error instanceof ApiError && error.code === 'SUMMARY_CHANGED') {
          this.store.dispatch(
            actions.summary(await this.api.summary(s.checkout.id)),
          );
          delete this.progress.idempotencyKey;
          this.save('summary');
          throw error;
        }
        throw error;
      }
      this.progress.transactionId = t.id;
      this.store.dispatch(actions.attempt(t));
      this.save('result');
      try {
        this.store.dispatch(
          actions.attempt(
            await this.api.pay(t.id, this.token, this.config, this.consent),
          ),
        );
      } catch (error) {
        try {
          this.store.dispatch(actions.attempt(await this.api.attempt(t.id)));
        } catch {
          /* Result screen preserves the known ID; never resend pay. */
        }
        throw error;
      } finally {
        this.forgetCard();
      }
    });
  }
  async recover() {
    await this.run(async () => {
      await this.api.session();
      if (this.progress.checkoutId) await this.restore();
    });
  }
  async history() {
    await this.run(async () => {
      await this.api.session();
      this.store.dispatch(actions.purchases(await this.api.purchases()));
    });
  }
  async openPurchase(item: PurchaseHistoryItem) {
    await this.run(async () => {
      await this.api.session();
      const [checkout, attempt] = await Promise.all([
        this.api.checkout(item.checkoutId),
        this.api.attempt(item.id),
      ]);
      this.progress = {
        checkoutId: checkout.id,
        transactionId: attempt.id,
        step: 'result',
      };
      this.store.dispatch(actions.checkout(checkout));
      this.store.dispatch(actions.attempt(attempt));
      this.store.dispatch(actions.summary(attempt.summary ?? null));
      this.save('result');
    });
  }
  async sync() {
    await this.run(async () => {
      const id = this.progress.transactionId;
      if (!id) return;
      const current = await this.api.attempt(id);
      this.store.dispatch(actions.attempt(current));
      if (current.status === 'PENDING' && current.dispatchStatus !== 'NOT_SENT')
        this.store.dispatch(actions.attempt(await this.api.sync(id)));
    });
  }
  edit() {
    this.navigate('details');
  }
  close() {
    this.forgetCard();
    this.save('catalog');
  }
  async back() {
    await this.run(async () => {
      this.forgetCard();
      const t = this.store.getState().attempt;
      if (t?.status !== 'PENDING') {
        this.progress = { step: 'catalog' };
        this.store.dispatch(actions.reset());
        if (t?.status === 'APPROVED') this.store.dispatch(actions.cart(null));
      }
      this.store.dispatch(actions.products(await this.api.products()));
      this.save('catalog');
    });
  }
}
