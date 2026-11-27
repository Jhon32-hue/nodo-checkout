import { useEffect, useRef, type ReactNode } from 'react';
import MuiDialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import styles from '../App.module.css';

export function Dialog({
  title,
  onClose,
  children,
  error,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [title]);
  useEffect(() => {
    if (!error || !content.current) return;
    content.current.scrollTop = 0;
    content.current.querySelector<HTMLElement>('[role="alert"]')?.focus();
  }, [error]);
  return (
    <MuiDialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="dialog-title"
      slotProps={{
        paper: {
          sx: {
            width: 'min(560px, calc(100vw - 24px))',
            maxHeight: 'min(760px, calc(100dvh - 24px))',
            m: 1.5,
            overflow: 'hidden',
          },
        },
      }}
    >
      <div className={styles.dialogHeader}>
        <DialogTitle
          id="dialog-title"
          sx={{ fontSize: 24, fontWeight: 700, pb: 1 }}
        >
          {title}
        </DialogTitle>
        <IconButton aria-label="Cerrar" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      <DialogContent ref={content} dividers className={styles.dialogContent}>
        {children}
      </DialogContent>
    </MuiDialog>
  );
}
