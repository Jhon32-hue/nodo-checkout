import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PurchaseDetail } from './PurchaseDetail';
import { api, ApiError } from '../services/api';
import { attempt, checkout, delivery, product } from '../../test/fixtures';
import type { PurchaseHistoryItem } from '../types';
jest.mock('../services/api', () => ({
  ...jest.requireActual('../services/api'),
  api: {
    checkout: jest.fn(),
    attempt: jest.fn(),
    sync: jest.fn(),
    pay: jest.fn(),
  },
}));
const item: PurchaseHistoryItem = {
  ...attempt,
  productName: product.name,
  quantity: 1,
  totalCents: 13140000,
  currency: 'COP',
  reference: 'ref',
  createdAt: '2026-11-26',
  deliveryId: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.checkout).mockResolvedValue({ ...checkout, delivery });
  jest
    .mocked(api.attempt)
    .mockResolvedValue({ ...attempt, dispatchStatus: 'UNKNOWN' });
});
it('consulta datos propios, muestra entrega e importes sin UUID ni tarjeta y sincroniza solo por clic', async () => {
  const close = jest.fn();
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const { unmount } = render(
    <PurchaseDetail item={item} products={[product]} onClose={close} />,
  );
  expect(screen.getByRole('status')).toBeInTheDocument();
  await screen.findByText(delivery.addressLine1, { exact: false });
  expect(screen.getByText('Tarjeta de crédito')).toBeInTheDocument();
  expect(screen.getByText('Total COP')).toBeInTheDocument();
  expect(screen.queryByText(attempt.id)).not.toBeInTheDocument();
  expect(screen.queryByText(checkout.id)).not.toBeInTheDocument();
  expect(api.sync).not.toHaveBeenCalled();
  expect(api.pay).not.toHaveBeenCalled();
  jest.mocked(api.sync).mockResolvedValue({ ...attempt, status: 'APPROVED' });
  fireEvent.click(screen.getByRole('button', { name: 'Consultar estado' }));
  await screen.findByText('Compra confirmada.');
  expect(api.sync).toHaveBeenCalledWith(item.id);
  expect(api.pay).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
  expect(close).toHaveBeenCalled();
  unmount();
  await waitFor(() => expect(opener).toHaveFocus());
  opener.remove();
});
it('una sesión ajena no muestra datos y permite reintentar la lectura', async () => {
  jest
    .mocked(api.checkout)
    .mockRejectedValueOnce(new ApiError('RESOURCE_NOT_FOUND'));
  render(
    <PurchaseDetail item={item} products={[product]} onClose={jest.fn()} />,
  );
  await screen.findByRole('alert');
  expect(screen.queryByText(delivery.addressLine1)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
  await screen.findByText(delivery.addressLine1, { exact: false });
  expect(api.pay).not.toHaveBeenCalled();
  expect(api.sync).not.toHaveBeenCalled();
});
