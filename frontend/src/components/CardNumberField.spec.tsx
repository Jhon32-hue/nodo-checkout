import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '../state/store';
import { CardNumberField } from './CardNumberField';

function Subject({ onValidate = jest.fn() }: { onValidate?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <CardNumberField
      value={value}
      onChange={setValue}
      onBlur={jest.fn()}
      inputRef={jest.fn()}
      error={false}
      onValidate={onValidate}
    />
  );
}

const setup = () => {
  const store = makeStore();
  render(
    <Provider store={store}>
      <Subject />
    </Provider>,
  );
  return {
    input: screen.getByLabelText('Número de tarjeta') as HTMLInputElement,
    store,
  };
};

it('formatea escritura, bloquea letras y conserva solo dígitos', () => {
  const { input } = setup();
  fireEvent.change(input, {
    target: { value: '4242a4242-4242 4242', selectionStart: 19 },
  });
  expect(input).toHaveValue('4242 4242 4242 4242');
  expect(input).toHaveAttribute('inputmode', 'numeric');
});

it.each([
  ['42424242424242424242', 19],
  ['55555555555544449', 16],
])('bloquea %s en su máximo %i e informa el recorte', (pasted, max) => {
  const { input } = setup();
  fireEvent.paste(input, {
    clipboardData: { getData: () => pasted },
  });
  expect(input.value.replace(/\s/g, '')).toHaveLength(max);
  expect(screen.getByRole('alert')).toHaveTextContent(
    `El número admite máximo ${max} dígitos.`,
  );
});

it('solicita validación al perder foco y al completar una longitud admitida', () => {
  const onValidate = jest.fn();
  const store = makeStore();
  render(
    <Provider store={store}>
      <Subject onValidate={onValidate} />
    </Provider>,
  );
  const input = screen.getByLabelText('Número de tarjeta');
  fireEvent.change(input, {
    target: { value: '4242424242424242', selectionStart: 16 },
  });
  expect(onValidate).toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onValidate).toHaveBeenCalledTimes(2);
});

it('acepta pegado, recorta al límite y deja el cursor después del contenido', () => {
  const { input } = setup();
  fireEvent.paste(input, {
    clipboardData: { getData: () => '4242-4242 4242-4242' },
  });
  expect(input).toHaveValue('4242 4242 4242 4242');
  expect(input.selectionStart).toBe(19);
});

it('conserva el cursor al borrar y editar en medio', () => {
  const { input } = setup();
  fireEvent.change(input, {
    target: { value: '4242424242424242', selectionStart: 16 },
  });
  fireEvent.change(input, {
    target: { value: '4242 242 4242 4242', selectionStart: 5 },
  });
  expect(input).toHaveValue('4242 2424 2424 242');
  expect(input.selectionStart).toBe(4);
  fireEvent.change(input, {
    target: { value: '42429 2424 2424 242', selectionStart: 5 },
  });
  expect(input).toHaveValue('4242 9242 4242 4242');
  expect(input.selectionStart).toBe(6);
});

it.each([
  ['Visa', '4242'],
  ['Mastercard', '5100'],
  ['Mastercard', '5500'],
  ['Mastercard', '2221'],
  ['Mastercard', '2720'],
])('muestra únicamente el logo %s para %s', (name, value) => {
  const { input } = setup();
  fireEvent.change(input, { target: { value, selectionStart: value.length } });
  expect(screen.getByLabelText(`Marca detectada: ${name}`)).toBeInTheDocument();
});

it('oculta logos para un número desconocido y no persiste el PAN', () => {
  const { input, store } = setup();
  fireEvent.change(input, { target: { value: '1234', selectionStart: 4 } });
  expect(screen.queryByLabelText(/Marca detectada/)).not.toBeInTheDocument();
  expect(JSON.stringify(store.getState())).not.toContain('1234');
  expect(JSON.stringify(localStorage)).not.toContain('1234');
  expect(JSON.stringify(sessionStorage)).not.toContain('1234');
});
