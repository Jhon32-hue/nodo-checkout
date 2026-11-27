import ButtonBase from '@mui/material/ButtonBase';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import type { Step } from '../types';
import type { Flow } from '../state/flow';
import styles from '../App.module.css';

const stages = [
  { step: 'catalog', label: 'Producto', icon: Inventory2OutlinedIcon },
  { step: 'details', label: 'Pago', icon: CreditCardOutlinedIcon },
  { step: 'summary', label: 'Resumen', icon: ReceiptLongOutlinedIcon },
  { step: 'result', label: 'Resultado', icon: TaskAltOutlinedIcon },
] as const;

export function CheckoutProgress({
  flow,
  current,
  busy,
  onNavigate,
}: {
  flow: Flow;
  current: Step;
  busy: boolean;
  onNavigate: (step: Step) => void;
}) {
  const nextBlocked = stages.find(
    ({ step }) => step !== current && !flow.navigation(step).enabled,
  );
  return (
    <>
      <nav className={styles.checkoutProgress} aria-label="Pasos de compra">
        {stages.map(({ step, label, icon: Icon }) => {
          const access = flow.navigation(step);
          const state =
            current === step
              ? 'actual'
              : access.completed
                ? 'completado'
                : access.enabled
                  ? 'disponible'
                  : 'bloqueado';
          return (
            <div className={styles.progressStage} key={step}>
              <ButtonBase
                type="button"
                className={styles.progressButton}
                data-state={state}
                aria-current={current === step ? 'step' : undefined}
                aria-label={`${label}, ${state}${!access.enabled ? `. ${access.reason}` : ''}`}
                title={!access.enabled ? access.reason : label}
                disabled={busy || !access.enabled || current === step}
                onClick={() => onNavigate(step)}
              >
                <Icon aria-hidden="true" fontSize="small" />
              </ButtonBase>
              <span>{label}</span>
            </div>
          );
        })}
      </nav>
      {nextBlocked && (
        <p className={styles.progressHint}>
          {nextBlocked.label}: {flow.navigation(nextBlocked.step).reason}
        </p>
      )}
    </>
  );
}
