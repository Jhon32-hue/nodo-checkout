import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { ProductCard } from './ProductCard';
import { ProductDetail } from './ProductDetail';
import { CartDrawer } from './CartDrawer';
import { Summary } from './Summary';
import { Result, paymentPresentation } from './Result';
import { Dialog } from './Dialog';
import { DetailsForm } from './DetailsForm';
import type { Flow } from '../state/flow';
import {
  product,
  summary,
  attempt,
  checkout,
  config,
  card,
} from '../../test/fixtures';
function flow() {
  return {
    configuration: jest.fn().mockResolvedValue(config),
    details: jest.fn().mockResolvedValue(undefined),
    sync: jest.fn().mockResolvedValue(undefined),
    recover: jest.fn(),
    back: jest.fn(),
    finishApprovedTransition: jest.fn(),
    invalidateSummary: jest.fn(),
  } as unknown as Flow;
}
it('muestra resumen histórico sin acción de pago', () => {
  const confirm = jest.fn();
  render(
    <Summary
      summary={summary}
      product={product}
      busy={false}
      onConfirm={confirm}
      onEdit={jest.fn()}
      readOnly
    />,
  );
  expect(screen.getByRole('img', { name: product.name })).toBeInTheDocument();
  expect(screen.getByText('Tarifa base')).toBeInTheDocument();
  expect(screen.getByText('Entrega')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Confirmar y pagar' }),
  ).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});
it('muestra catálogo y abre detalle desde imagen y nombre con fallback de imagen', () => {
  const open = jest.fn();
  const add = jest.fn();
  const { rerender } = render(
    <ProductCard product={product} onOpen={open} onAdd={add} />,
  );
  expect(screen.getByText('10 disponibles')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: product.name })).toHaveAttribute(
    'src',
    '/images/products/aud-001.jpeg',
  );
  fireEvent.click(
    screen.getByRole('button', { name: `Agregar ${product.name} al carrito` }),
  );
  expect(add).toHaveBeenCalledWith(product.id);
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver detalle de ' + product.name }),
  );
  fireEvent.click(screen.getByRole('button', { name: product.name }));
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledWith(product.id);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', product.name);
  rerender(
    <ProductCard
      product={{ ...product, category: null, available: 0 }}
      onOpen={open}
      onAdd={add}
    />,
  );
  expect(screen.getByText('Sin clasificar')).toBeInTheDocument();
  expect(screen.getByText('Agotado')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: `Agregar ${product.name} al carrito` }),
  ).toBeDisabled();
  rerender(
    <ProductCard
      product={{ ...product, category: 'otro' }}
      onOpen={open}
      onAdd={add}
    />,
  );
  expect(screen.getByText('otro')).toBeInTheDocument();
});
it('detalle limita cantidad, agrega y compra solo por clic', () => {
  const add = jest.fn(),
    buy = jest.fn(),
    back = jest.fn();
  render(
    <ProductDetail
      product={{ ...product, available: 2 }}
      disabled={false}
      onAdd={add}
      onBuy={buy}
      onBack={back}
    />,
  );
  expect(buy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Aumentar Cantidad/ }));
  expect(screen.getByRole('spinbutton')).toHaveValue(2);
  expect(
    screen.getByRole('button', { name: /Aumentar Cantidad/ }),
  ).toBeDisabled();
  fireEvent.click(screen.getByText('Agregar al carrito'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Pagar con tarjeta de crédito' }),
  );
  expect(add).toHaveBeenCalledWith(2);
  expect(buy).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByText(/Volver al catálogo/));
  expect(back).toHaveBeenCalled();
});
it('carrito muestra subtotal, modifica unidades y cierra devolviendo foco', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const quantity = jest.fn(),
    remove = jest.fn(),
    checkout = jest.fn(),
    close = jest.fn(),
    explore = jest.fn();
  const { unmount } = render(
    <CartDrawer
      cart={{ productId: product.id, quantity: 1 }}
      product={product}
      busy={false}
      onQuantity={quantity}
      onRemove={remove}
      onCheckout={checkout}
      onClose={close}
      onExplore={explore}
    />,
  );
  expect(screen.getByText('Subtotal del producto')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: /Aumentar Cantidad en carrito/ }),
  );
  expect(quantity).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByText('Pagar con tarjeta de crédito'));
  expect(checkout).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Eliminar producto'));
  expect(remove).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByLabelText('Cerrar carrito'));
  expect(close).toHaveBeenCalledTimes(1);
  unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});
it('muestra todos los importes del servidor y confirma solo al hacer clic', () => {
  const confirm = jest.fn(),
    edit = jest.fn();
  const { rerender } = render(
    <Summary
      summary={summary}
      product={product}
      busy={false}
      onConfirm={confirm}
      onEdit={edit}
    />,
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText('Subtotal')).toBeInTheDocument();
  expect(screen.getByText('Tarifa base')).toBeInTheDocument();
  expect(screen.getByText('Entrega')).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Confirmar y pagar/));
  expect(confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Volver a tarjeta y entrega'));
  expect(edit).toHaveBeenCalledTimes(1);
  rerender(
    <Summary summary={summary} busy={true} onConfirm={confirm} onEdit={edit} />,
  );
  expect(screen.getByText('Tu producto')).toBeInTheDocument();
  expect(screen.getByText(/Procesando/)).toBeDisabled();
});
it.each([
  'APPROVED',
  'DECLINED',
  'VOIDED',
  'ERROR',
  'EXPIRED',
  'PENDING',
] as const)('presenta resultado %s sin confiar en navegador', (status) => {
  const f = flow();
  render(
    <Result
      attempt={{
        ...attempt,
        status,
        dispatchStatus: 'SUBMITTED',
        deliveryId: status === 'APPROVED' ? 'delivery' : null,
      }}
      flow={f}
      busy={false}
    />,
  );
  expect(screen.getByRole('heading')).toHaveTextContent(
    paymentPresentation({ ...attempt, status, dispatchStatus: 'SUBMITTED' })
      .title,
  );
  expect(screen.getByText('Referencia de compra')).toBeInTheDocument();
  expect(screen.getByText(attempt.reference!)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Identificadores técnicos'));
  expect(screen.getByText(attempt.checkoutId)).toBeInTheDocument();
  expect(screen.getByText(attempt.id)).toBeInTheDocument();
  if (status === 'APPROVED') {
    expect(screen.getByText(/gestionar la entrega/)).toBeInTheDocument();
    expect(screen.queryByText(/entrega lista/i)).not.toBeInTheDocument();
  }
  fireEvent.click(
    screen.getByText(
      status === 'APPROVED'
        ? /Volver al inicio ahora/
        : /Volver a los productos/,
    ),
  );
  if (status === 'APPROVED')
    expect(f.finishApprovedTransition).toHaveBeenCalled();
  else expect(f.back).toHaveBeenCalled();
});
it('UNKNOWN no consulta automáticamente ni ofrece reenviar un cobro', async () => {
  jest.useFakeTimers();
  const f = flow();
  render(
    <Result
      attempt={{ ...attempt, dispatchStatus: 'UNKNOWN' }}
      flow={f}
      busy={false}
    />,
  );
  await act(async () => jest.advanceTimersByTime(300000));
  expect(f.sync).not.toHaveBeenCalled();
  expect(screen.getByText('Resultado incierto')).toBeInTheDocument();
  expect(screen.queryByText(/volver a pagar/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Consultar estado'));
  expect(f.sync).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
it('limita polling, cancela temporizadores al salir y permite recuperación NOT_SENT', async () => {
  jest.useFakeTimers();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  const f = flow();
  const { unmount, rerender } = render(
    <Result
      attempt={{ ...attempt, dispatchStatus: 'SUBMITTED' }}
      flow={f}
      busy={false}
    />,
  );
  await act(async () => jest.runAllTimersAsync());
  expect(f.sync).toHaveBeenCalledTimes(8);
  expect(screen.getByRole('status')).toHaveTextContent('terminó');
  rerender(<Result attempt={attempt} flow={f} busy={false} />);
  fireEvent.click(screen.getByText('Recuperar tarjeta y entrega'));
  expect(f.recover).toHaveBeenCalled();
  unmount();
  await act(async () => jest.runAllTimersAsync());
  expect(f.sync).toHaveBeenCalledTimes(8);
  jest.useRealTimers();
});
it('omite consultas ocultas y no solapa solicitudes pendientes', async () => {
  jest.useFakeTimers();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: true,
  });
  const f = flow();
  const { unmount } = render(
    <Result
      attempt={{ ...attempt, dispatchStatus: 'IN_FLIGHT' }}
      flow={f}
      busy={false}
    />,
  );
  await act(async () => jest.advanceTimersByTime(5000));
  expect(f.sync).not.toHaveBeenCalled();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  let resolve: () => void = () => {};
  jest.mocked(f.sync).mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    }),
  );
  await act(async () => jest.advanceTimersByTime(10000));
  expect(f.sync).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(60000));
  expect(f.sync).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => resolve());
  jest.useRealTimers();
});
it('modal es accesible, cierra por escape y restaura foco', () => {
  const previous = document.createElement('button');
  document.body.append(previous);
  previous.focus();
  const close = jest.fn();
  const { unmount, rerender } = render(
    <Dialog title="Datos" onClose={close}>
      <input aria-label="Primero" />
    </Dialog>,
  );
  expect(screen.getByRole('dialog')).toHaveAttribute(
    'aria-labelledby',
    'dialog-title',
  );
  expect(screen.getByRole('dialog')).toContainElement(
    document.activeElement as HTMLElement,
  );
  fireEvent.click(screen.getByLabelText('Cerrar'));
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(2);
  rerender(
    <Dialog title="Resumen" onClose={close}>
      <button>Confirmar</button>
    </Dialog>,
  );
  expect(screen.getByText('Confirmar')).toHaveFocus();
  unmount();
  expect(previous).toHaveFocus();
  previous.remove();
});
it('contratos independientes sin preselección, errores junto a campos y tarjeta solo en formulario', async () => {
  const f = flow();
  const { unmount } = render(
    <DetailsForm checkout={checkout} flow={f} busy={false} />,
  );
  expect(screen.getByText('Tarjeta de crédito')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await waitFor(() =>
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0),
  );
  expect(f.details).not.toHaveBeenCalled();
  const cardFields: Record<string, string> = {
    'Número de tarjeta': card.number,
    'Titular de la tarjeta': card.holder,
    'Mes (MM)': card.month,
    'Año (AAAA)': card.year,
    CVC: card.cvc,
  };
  for (const [label, value] of Object.entries(cardFields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'Tus datos' });
  expect(f.details).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Entrega, bloqueado' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Tarjeta, completado' }));
  expect(screen.getByLabelText('Número de tarjeta')).toHaveValue(
    '4111 1111 1111 1111',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Comprador, completado' }),
  );
  await screen.findByRole('heading', { name: 'Tus datos' });
  const buyerFields: Record<string, string> = {
    'Nombre completo': 'Cliente Prueba',
    'Correo electrónico': 'cliente@example.test',
    'Teléfono del comprador': '+573001234567',
  };
  for (const [label, value] of Object.entries(buyerFields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByText('Datos de entrega');
  expect(
    screen.getByRole('button', { name: 'Comprador, completado' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('link', { name: 'contrato de pago' }),
  ).toHaveAttribute('href', config.acceptance.policyUrl);
  for (const checkbox of screen.getAllByRole('checkbox'))
    expect(checkbox).not.toBeChecked();
  const deliveryFields: Record<string, string> = {
    'Nombre de quien recibe': 'Cliente Prueba',
    'Teléfono de entrega': '+573001234567',
    Dirección: 'Calle de prueba 1',
    Ciudad: 'Bogotá',
    Departamento: 'Bogotá',
  };
  for (const [label, value] of Object.entries(deliveryFields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  for (const checkbox of screen.getAllByRole('checkbox'))
    fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Ver resumen' }));
  await waitFor(() => expect(f.details).toHaveBeenCalledTimes(1));
  unmount();
});
it('error de configuración no habilita tokenización', async () => {
  const f = flow();
  jest.mocked(f.configuration).mockRejectedValue(new Error('secret'));
  render(
    <DetailsForm
      checkout={{
        ...checkout,
      }}
      flow={f}
      busy={false}
    />,
  );
  expect(await screen.findByText('Tarjeta de crédito')).toBeInTheDocument();
  expect(screen.queryByText(/No se pudieron cargar/)).not.toBeInTheDocument();
  expect(f.details).not.toHaveBeenCalled();
  expect(screen.queryByText('secret')).not.toBeInTheDocument();
});
