import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  spacing: 8,
  palette: {
    primary: { main: '#2563EB' },
    background: { default: '#F3F6FB', paper: '#FFFFFF' },
    text: { primary: '#0F172A', secondary: '#475569' },
    divider: '#E2E8F0',
    success: { main: '#15803D' },
    warning: { main: '#B45309' },
    error: { main: '#B91C1C' },
  },
  typography: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 16 },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 48,
          borderRadius: 10,
          fontWeight: 700,
          textTransform: 'none',
          paddingInline: 16,
        },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', fullWidth: true },
      styleOverrides: {
        root: {
          '& .MuiInputBase-root': {
            minHeight: 52,
            background: '#FFFFFF',
            fontSize: 16,
          },
          '& .MuiInputLabel-root': { fontSize: 16 },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          maxHeight: 'min(720px, calc(100dvh - 24px))',
          overflow: 'hidden',
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: { root: { padding: 24, overflowY: 'auto' } },
    },
  },
});
