export interface Product {
  id: string;
  sku: string;
  category: string | null;
  name: string;
  description: string;
  imageUrl: string;
  unitPriceCents: number;
  currency: 'COP';
  available: number;
}
export interface Buyer {
  fullName: string;
  email: string;
  phone: string;
}
export interface Delivery {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region: string;
  country: 'CO';
  postalCode?: string | null;
}
export interface Checkout {
  id: string;
  productId: string;
  quantity: number;
  status: 'DRAFT' | 'PAYMENT_PENDING' | 'PAID';
  buyer: Buyer | null;
  delivery: Delivery | null;
  activeTransactionId: string | null;
  latestTransactionId: string | null;
  deliveryId: string | null;
}
export interface Summary {
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  baseFeeCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  currency: 'COP';
}
export interface Attempt {
  id: string;
  checkoutId: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | 'EXPIRED';
  dispatchStatus:
    'NOT_SENT' | 'IN_FLIGHT' | 'SUBMITTED' | 'UNKNOWN' | 'NOT_CREATED';
  reservationExpiresAt: string;
  reservationStatus?: string;
  reservationExpired?: boolean;
  deliveryId: string | null;
  summary?: Summary;
}
export interface PurchaseHistoryItem {
  id: string;
  checkoutId: string;
  productName: string;
  quantity: number;
  totalCents: number;
  currency: 'COP';
  reference: string;
  status: Attempt['status'];
  dispatchStatus: Attempt['dispatchStatus'];
  createdAt: string;
  deliveryId: string | null;
}
export interface Config {
  environment: 'UAT_SANDBOX';
  publicKey: string;
  tokenizationPublicKey: string;
  tokenizationUrl: string;
  installments: 1;
  acceptance: {
    acceptanceToken: string;
    personalAuthToken: string;
    policyUrl: string;
    personalDataUrl: string;
  };
}
export interface Card {
  number: string;
  holder: string;
  month: string;
  year: string;
  cvc: string;
}
export interface Consent {
  policy: boolean;
  personal: boolean;
}
export type Step = 'catalog' | 'details' | 'summary' | 'result';
