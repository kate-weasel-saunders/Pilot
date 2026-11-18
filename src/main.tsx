import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';
import './styles/components.css';

// Ask the browser not to evict IndexedDB under storage pressure, since unsynced
// check-ins may live there. Best effort; Safari may ignore it.
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
