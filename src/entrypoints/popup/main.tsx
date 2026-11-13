import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { applyAppearance } from '../../ui/appearance';
import '../../ui/style.css';
import { Popup } from './Popup';

// The system theme until the settings load (they may choose another).
applyAppearance(undefined);

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Popup />
  </ErrorBoundary>,
);
