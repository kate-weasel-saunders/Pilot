import { syncNow } from '../data/syncController';

/**
 * Runs the user's "Send to Pilot" Shortcut via the Shortcuts URL scheme. iOS
 * only lets Shortcuts read Health while the phone is unlocked, so a button the
 * user taps is the reliable path; background automations are a bonus.
 *
 * Shortcuts can't hand control back to a Home Screen web app (a return URL
 * would open Safari instead), so when the user comes back to Pilot we sync
 * straight away and again a few seconds later, in case the Shortcut was still
 * sending.
 */
export const SHORTCUT_NAME = 'Send to Pilot';
export const SHORTCUT_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

let armed = false;

function onVisible() {
  if (!armed || document.visibilityState !== 'visible') return;
  armed = false;
  document.removeEventListener('visibilitychange', onVisible);
  void syncNow();
  setTimeout(() => void syncNow(), 6000);
  setTimeout(() => void syncNow(), 15000);
}

export function runHealthShortcut(): void {
  if (!armed) {
    armed = true;
    document.addEventListener('visibilitychange', onVisible);
  }
  window.location.href = SHORTCUT_URL;
}
