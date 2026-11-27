import { fireEvent, render, screen } from '@testing-library/react';
import type { Flow } from '../state/flow';
import { CheckoutProgress } from './CheckoutProgress';

it('permite revisar etapas válidas y bloquea Resultado antes del pago', () => {
  const onNavigate = jest.fn();
  const flow = {
    navigation: (step: string) => ({
      enabled: step === 'catalog' || step === 'details',
      completed: step === 'catalog',
      reason: step === 'result' ? 'Inicia el pago.' : 'Completa el formulario.',
    }),
  } as Flow;
  render(
    <CheckoutProgress
      flow={flow}
      current="details"
      busy={false}
      onNavigate={onNavigate}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Producto, completado' }));
  expect(onNavigate).toHaveBeenCalledWith('catalog');
  const result = screen.getByRole('button', { name: /Resultado, bloqueado/ });
  expect(result).toBeDisabled();
  fireEvent.click(result);
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Completa el formulario/)).toBeInTheDocument();
});
