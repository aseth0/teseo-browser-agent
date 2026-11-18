// The chat app, started once it may show (main, ticket-gate).
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { applyAppearance } from '../../ui/appearance';
import '../../ui/style.css';
import { listenKeysSetHere } from '../../shortcuts/listen';

// The system theme until the settings load (they may choose another).
applyAppearance(undefined);
// The keys set in Settings → Shortcuts work here too.
listenKeysSetHere();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
