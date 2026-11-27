import { render, screen } from '@testing-library/react';
import { CardBrands } from './CardBrands';

it('identifica Visa y Mastercard, y vuelve a neutro al borrar o cambiar', () => {
  const view = render(<CardBrands number="" />);
  expect(screen.queryByLabelText(/Marca detectada/)).not.toBeInTheDocument();
  view.rerender(<CardBrands number="4111" />);
  expect(screen.getByLabelText('Marca detectada: Visa')).toBeInTheDocument();
  expect(
    screen.queryByLabelText('Marca detectada: Mastercard'),
  ).not.toBeInTheDocument();
  view.rerender(<CardBrands number="2720" />);
  expect(
    screen.getByLabelText('Marca detectada: Mastercard'),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText('Marca detectada: Visa'),
  ).not.toBeInTheDocument();
  view.rerender(<CardBrands number="2721" />);
  expect(screen.queryByLabelText(/Marca detectada/)).not.toBeInTheDocument();
});
