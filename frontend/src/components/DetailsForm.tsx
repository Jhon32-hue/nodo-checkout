import { useEffect, useState } from 'react';
import { useForm, Controller, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import { formSchema, type FormValues } from '../validation';
import { CardNumberField } from './CardNumberField';
import type {
  PublicCheckout,
  Config,
  Buyer,
  Delivery,
  Card,
  Consent,
} from '../types';
import type { Flow } from '../state/flow';
import styles from '../App.module.css';

type Phase = 'card' | 'buyer' | 'delivery';
export type DetailsDraft = {
  buyer?: Buyer;
  delivery?: Delivery;
  card?: Card;
  consent?: Consent;
};
const cardNames: Path<FormValues>[] = [
  'card.number',
  'card.holder',
  'card.month',
  'card.year',
  'card.cvc',
];
const buyerNames: Path<FormValues>[] = [
  'buyer.fullName',
  'buyer.email',
  'buyer.phone',
];
export function DetailsForm({
  checkout,
  flow,
  busy,
  draft,
  onDraftChange,
}: {
  checkout: PublicCheckout;
  flow: Flow;
  busy: boolean;
  draft?: DetailsDraft;
  onDraftChange?: (draft: DetailsDraft) => void;
}) {
  const [phase, setPhase] = useState<Phase>('card');
  const [optional, setOptional] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    trigger,
    subscribe,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    shouldUnregister: false,
    defaultValues: {
      buyer: draft?.buyer ?? { fullName: '', email: '', phone: '' },
      delivery: {
        recipientName: '',
        phone: '',
        addressLine1: '',
        city: '',
        region: '',
        ...draft?.delivery,
        addressLine2: draft?.delivery?.addressLine2 ?? '',
        postalCode: draft?.delivery?.postalCode ?? '',
        country: 'CO',
      },
      card: draft?.card ?? {
        number: '',
        holder: '',
        month: '',
        year: '',
        cvc: '',
      },
      policy: draft?.consent?.policy ?? false,
      personal: draft?.consent?.personal ?? false,
    },
  });
  useEffect(() => {
    let active = true;
    void flow
      .configuration()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => {
        if (active) setConfigError(true);
      });
    return () => {
      active = false;
    };
  }, [flow]);
  useEffect(() => {
    return subscribe({
      formState: { values: true },
      callback: ({ values, name }) => {
        if (name?.startsWith('card.')) flow.invalidateSummary();
        onDraftChange?.({
          buyer: values.buyer as Buyer,
          delivery: values.delivery as Delivery,
          card: values.card as Card,
          consent: {
            policy: Boolean(values.policy),
            personal: Boolean(values.personal),
          },
        });
      },
    });
  }, [subscribe, onDraftChange, flow]);
  useEffect(() => {
    const first = {
      card: 'card.number',
      buyer: 'buyer.fullName',
      delivery: 'delivery.recipientName',
    }[phase];
    document.getElementById(first)?.focus();
  }, [phase]);
  const field = (
    name: Path<FormValues>,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => {
    const error = name
      .split('.')
      .reduce<unknown>(
        (value, part) =>
          value && typeof value === 'object'
            ? Reflect.get(value, part)
            : undefined,
        errors,
      );
    const message =
      error && typeof error === 'object'
        ? Reflect.get(error, 'message')
        : undefined;
    const { ref, ...input } = register(name);
    return (
      <TextField
        key={name}
        label={label}
        id={name}
        {...input}
        disabled={
          checkout.status !== 'DRAFT' &&
          (name.startsWith('buyer.') || name.startsWith('delivery.'))
        }
        inputRef={ref}
        slotProps={{ htmlInput: props, formHelperText: { role: 'alert' } }}
        error={typeof message === 'string'}
        helperText={typeof message === 'string' ? message : undefined}
      />
    );
  };
  const next = async () => {
    if (phase === 'card' && (await trigger(cardNames))) {
      setPhase('buyer');
    } else if (phase === 'buyer' && (await trigger(buyerNames))) {
      setPhase('delivery');
    }
  };
  const back = () => setPhase(phase === 'delivery' ? 'buyer' : 'card');
  const submit = handleSubmit(async (values) => {
    const { buyer, delivery, card, policy, personal } = values;
    await flow.details(
      buyer,
      {
        ...delivery,
        addressLine2: delivery.addressLine2 || undefined,
        postalCode: delivery.postalCode || undefined,
      },
      card,
      { policy, personal },
    );
  });
  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (phase === 'delivery') void submit(event);
        else void next();
      }}
    >
      <div
        className={styles.formProgressBar}
        role="progressbar"
        aria-label={`Paso ${phase === 'card' ? 1 : phase === 'buyer' ? 2 : 3} de 3`}
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={phase === 'card' ? 1 : phase === 'buyer' ? 2 : 3}
      >
        <span data-phase={phase} />
      </div>
      <div className={styles.stepHeading}>
        {phase === 'card' ? (
          <CreditCardIcon color="primary" />
        ) : phase === 'delivery' ? (
          <LocalShippingIcon color="primary" />
        ) : null}
        <div>
          <span>
            Paso {phase === 'card' ? '1' : phase === 'buyer' ? '2' : '3'} de 3
          </span>
          <h3>
            {phase === 'card'
              ? 'Tarjeta de crédito'
              : phase === 'buyer'
                ? 'Tus datos'
                : 'Datos de entrega'}
          </h3>
        </div>
      </div>
      {phase === 'card' && (
        <section className={styles.formSection}>
          <p className={styles.muted}>
            Usa únicamente datos ficticios de prueba.
          </p>
          <div className={styles.formStack}>
            <Controller
              name="card.number"
              control={control}
              render={({ field: cardNumber, fieldState }) => (
                <CardNumberField
                  value={cardNumber.value}
                  onChange={cardNumber.onChange}
                  onBlur={cardNumber.onBlur}
                  inputRef={cardNumber.ref}
                  error={fieldState.invalid}
                  helperText={fieldState.error?.message}
                  onValidate={() => void trigger('card.number')}
                />
              )}
            />
            {field('card.holder', 'Titular de la tarjeta', {
              maxLength: 120,
              autoComplete: 'off',
            })}
            <div className={`${styles.formRow} ${styles.cardExpiry}`}>
              {field('card.month', 'Mes (MM)', {
                inputMode: 'numeric',
                maxLength: 2,
              })}
              {field('card.year', 'Año (AAAA)', {
                inputMode: 'numeric',
                maxLength: 4,
              })}
              {field('card.cvc', 'CVC', {
                inputMode: 'numeric',
                type: 'password',
                maxLength: 4,
                autoComplete: 'off',
              })}
            </div>
          </div>
        </section>
      )}
      {phase === 'buyer' && (
        <section className={`${styles.formStack} ${styles.formSection}`}>
          {checkout.status !== 'DRAFT' && (
            <p className={styles.muted}>
              Los datos de esta compra reservada no se pueden modificar.
            </p>
          )}
          {field('buyer.fullName', 'Nombre completo', {
            autoComplete: 'name',
            maxLength: 120,
          })}
          {field('buyer.email', 'Correo electrónico', {
            type: 'email',
            autoComplete: 'email',
            maxLength: 254,
          })}
          {field('buyer.phone', 'Teléfono del comprador', {
            type: 'tel',
            placeholder: '+573001234567',
            maxLength: 16,
          })}
        </section>
      )}
      {phase === 'delivery' && (
        <section className={styles.formSection}>
          <div className={styles.formStack}>
            {field('delivery.recipientName', 'Nombre de quien recibe', {
              maxLength: 120,
            })}
            {field('delivery.phone', 'Teléfono de entrega', {
              type: 'tel',
              maxLength: 16,
            })}
            {field('delivery.addressLine1', 'Dirección', { maxLength: 200 })}
            <div className={styles.formRow}>
              {field('delivery.city', 'Ciudad', { maxLength: 100 })}
              {field('delivery.region', 'Departamento', { maxLength: 100 })}
            </div>
            <Button
              type="button"
              variant="text"
              onClick={() => setOptional(!optional)}
            >
              {optional
                ? 'Ocultar campos opcionales'
                : 'Agregar apartamento o código postal'}
            </Button>
            {optional && (
              <div className={styles.formRow}>
                {field('delivery.addressLine2', 'Apartamento o indicaciones', {
                  maxLength: 200,
                })}
                {field('delivery.postalCode', 'Código postal', {
                  maxLength: 12,
                })}
              </div>
            )}
          </div>
          <div className={styles.consents}>
            {config ? (
              <>
                <label>
                  <Controller
                    name="policy"
                    control={control}
                    render={({ field }) => (
                      <Checkbox
                        disabled={busy}
                        checked={field.value}
                        onChange={(_, checked) => field.onChange(checked)}
                        slotProps={{ input: { ref: field.ref } }}
                      />
                    )}
                  />{' '}
                  Acepto el{' '}
                  <a
                    href={config.acceptance.policyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    contrato de pago
                  </a>
                  .
                </label>
                {errors.policy && (
                  <small role="alert">{errors.policy.message}</small>
                )}
                <label>
                  <Controller
                    name="personal"
                    control={control}
                    render={({ field }) => (
                      <Checkbox
                        disabled={busy}
                        checked={field.value}
                        onChange={(_, checked) => field.onChange(checked)}
                        slotProps={{ input: { ref: field.ref } }}
                      />
                    )}
                  />{' '}
                  Autorizo el{' '}
                  <a
                    href={config.acceptance.personalDataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    tratamiento de datos personales
                  </a>
                  .
                </label>
                {errors.personal && (
                  <small role="alert">{errors.personal.message}</small>
                )}
              </>
            ) : (
              <p role="status">
                {configError
                  ? 'No se pudieron cargar los contratos. Cierra y vuelve a abrir.'
                  : 'Consultando contratos de Wompi…'}
              </p>
            )}
          </div>
        </section>
      )}
      <div className={styles.stepActions}>
        {phase !== 'card' && (
          <Button
            type="button"
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            disabled={busy}
            onClick={back}
          >
            Volver
          </Button>
        )}
        <Button
          type="submit"
          variant="contained"
          endIcon={
            busy ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <ArrowForwardIcon />
            )
          }
          disabled={busy || (phase === 'delivery' && !config)}
        >
          {busy
            ? 'Consultando resumen…'
            : phase === 'delivery'
              ? 'Ver resumen'
              : 'Continuar'}
        </Button>
      </div>
      {busy && (
        <p className={styles.operationStatus} role="status" aria-live="polite">
          Estamos consultando la información necesaria. Evita cerrar esta
          ventana o pulsar el botón nuevamente.
        </p>
      )}
    </form>
  );
}
