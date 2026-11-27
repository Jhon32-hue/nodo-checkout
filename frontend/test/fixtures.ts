import type {
  Product,
  Checkout,
  Summary,
  Attempt,
  Config,
  Card,
} from '../src/types';
export const product: Product = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'AUD-001',
  category: 'audio',
  name: 'Auriculares Nova',
  description: 'Audio para cada día',
  imageUrl: 'https://example.test/product.png',
  unitPriceCents: 12990000,
  currency: 'COP',
  available: 10,
};
export const checkout: Checkout = {
  id: '22222222-2222-4222-8222-222222222222',
  productId: product.id,
  quantity: 1,
  status: 'DRAFT',
  buyer: null,
  delivery: null,
  activeTransactionId: null,
  latestTransactionId: null,
  deliveryId: null,
};
export const buyer = {
  fullName: 'Cliente Ficticio',
  email: 'cliente@example.test',
  phone: '+573001234567',
};
export const delivery = {
  recipientName: 'Cliente Ficticio',
  phone: '+573001234567',
  addressLine1: 'Calle de ejemplo 1',
  city: 'Bogotá',
  region: 'Bogotá',
  country: 'CO' as const,
};
export const summary: Summary = {
  quantity: 1,
  unitPriceCents: 12990000,
  subtotalCents: 12990000,
  baseFeeCents: 50000,
  deliveryFeeCents: 100000,
  totalCents: 13140000,
  currency: 'COP',
};
export const attempt: Attempt = {
  id: '33333333-3333-4333-8333-333333333333',
  checkoutId: checkout.id,
  status: 'PENDING',
  dispatchStatus: 'NOT_SENT',
  reservationExpiresAt: '2030-01-01T00:00:00Z',
  reservationStatus: 'HELD',
  deliveryId: null,
  summary,
};
export const config: Config = {
  environment: 'UAT_SANDBOX',
  publicKey: 'pub_test_fixture',
  tokenizationPublicKey:
    '-----BEGIN PUBLIC KEY----- YWJj -----END PUBLIC KEY-----',
  tokenizationUrl: 'https://api-sandbox.co.uat.wompi.dev/v1/tokens/cards',
  installments: 1,
  acceptance: {
    acceptanceToken: 'policy-fixture',
    personalAuthToken: 'personal-fixture',
    policyUrl: 'https://example.test/policy',
    personalDataUrl: 'https://example.test/privacy',
  },
};
export const card: Card = {
  number: '4' + '1'.repeat(15),
  holder: 'Cliente Ficticio',
  month: '12',
  year: '2035',
  cvc: '123',
};
