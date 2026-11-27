import { fireEvent, render, screen } from '@testing-library/react';
import { Purchases, purchaseStatus } from './Purchases';
import type { PurchaseHistoryItem } from '../types';

const item = (
  change: Partial<PurchaseHistoryItem> = {},
): PurchaseHistoryItem => ({
  id: '33333333-3333-4333-8333-333333333333',
  checkoutId: '22222222-2222-4222-8222-222222222222',
  productName: 'Teclado mecánico K68',
  quantity: 1,
  totalCents: 19140000,
  currency: 'COP',
  reference: 'pc_fixture',
  status: 'APPROVED',
  dispatchStatus: 'SUBMITTED',
  createdAt: '2026-11-26T16:33:46.796Z',
  deliveryId: '44444444-4444-4444-8444-444444444444',
  ...change,
});

it('diferencia todos los estados y abre el detalle sin efectos propios', () => {
  const onOpen = jest.fn();
  const items = [
    item(),
    item({ id: '55555555-5555-4555-8555-555555555555', status: 'DECLINED' }),
    item({
      id: '66666666-6666-4666-8666-666666666666',
      status: 'PENDING',
      dispatchStatus: 'UNKNOWN',
    }),
    item({
      id: '77777777-7777-4777-8777-777777777777',
      status: 'ERROR',
    }),
    item({
      id: '88888888-8888-4888-8888-888888888888',
      status: 'VOIDED',
    }),
    item({
      id: '99999999-9999-4999-8999-999999999999',
      status: 'EXPIRED',
    }),
    item({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'PENDING',
      dispatchStatus: 'SUBMITTED',
    }),
  ];
  render(
    <Purchases
      items={items}
      loaded
      busy={false}
      error=""
      onRetry={jest.fn()}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText('Confirmada')).toBeInTheDocument();
  expect(screen.getByText('Rechazada')).toBeInTheDocument();
  expect(screen.getByText('Resultado incierto')).toBeInTheDocument();
  expect(screen.getByText('Error de pago')).toBeInTheDocument();
  expect(screen.getByText('Anulada')).toBeInTheDocument();
  expect(screen.getByText('Reserva vencida')).toBeInTheDocument();
  expect(screen.getByText('Verificando pago')).toBeInTheDocument();
  expect(screen.getAllByText('$ 191.400')).toHaveLength(7);
  fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
  expect(onOpen).toHaveBeenCalledWith(items[0]);
  expect(purchaseStatus(item({ status: 'PENDING' })).tone).toBe('warning');
});

it('consultar historial o abrir detalle no ejecuta pago ni sincronización', () => {
  const onOpen = jest.fn();
  const retry = jest.fn();
  render(
    <Purchases
      items={[item()]}
      loaded
      busy={false}
      error=""
      onRetry={retry}
      onOpen={onOpen}
    />,
  );
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/pagar/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sincronizar/i)).not.toBeInTheDocument();
});

it('presenta carga, vacío y error con reintento', () => {
  const retry = jest.fn();
  const { rerender } = render(
    <Purchases
      items={[]}
      loaded={false}
      busy
      error=""
      onRetry={retry}
      onOpen={jest.fn()}
    />,
  );
  expect(
    screen.getByRole('status', { name: 'Consultando tus compras' }),
  ).toBeInTheDocument();
  rerender(
    <Purchases
      items={[]}
      loaded
      busy={false}
      error=""
      onRetry={retry}
      onOpen={jest.fn()}
    />,
  );
  expect(screen.getByText(/Aún no hay compras/)).toHaveTextContent(
    'Explora los productos',
  );
  rerender(
    <Purchases
      items={[]}
      loaded
      busy={false}
      error="No fue posible consultar"
      onRetry={retry}
      onOpen={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
