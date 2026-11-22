import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupServiceWorker } from './lib/pwa';
import { applyTheme, getThemePref } from './lib/theme';
import '@fontsource-variable/plus-jakarta-sans';
import './styles/tokens.css';
import './styles/app.css';
import './styles/components.css';

// Ask the browser not to evict IndexedDB under storage pressure, since unsynced
// check-ins may live there. Best effort; Safari may ignore it.
applyTheme(getThemePref()); // before first render, so there's no flash of the wrong theme
void navigator.storage?.persist?.();
setupServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
