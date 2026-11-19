import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker registration. Home Screen apps on iOS are often resumed rather
 * than relaunched, so we also check for a new version whenever the app comes
 * back to the foreground (and hourly while open). With autoUpdate, a new
 * version activates and the page reloads; an unsaved check-in survives that
 * because drafts are saved on the device as you type.
 */
export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
    },
  });
}
