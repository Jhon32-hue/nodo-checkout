import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './theme';
import { makeStore } from './state/store';
import { Flow } from './state/flow';
import { api } from './services/api';
import { tokenize } from './services/tokenize';
import { App } from './App';
const store = makeStore();
const flow = new Flow(store, api, tokenize);
createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App flow={flow} />
    </ThemeProvider>
  </Provider>,
);
