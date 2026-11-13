import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { applyAppearance } from '../../ui/appearance';
import '../../ui/style.css';
import { listenKeysSetHere } from '../../shortcuts/listen';
import { AudioReview } from './AudioReview';

// The system theme until the settings load (they may choose another).
applyAppearance(undefined);
// The keys set in Settings → Shortcuts work here too.
listenKeysSetHere();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AudioReview />
  </ErrorBoundary>,
);
