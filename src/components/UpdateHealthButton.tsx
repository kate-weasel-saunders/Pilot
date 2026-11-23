import { runHealthShortcut, SHORTCUT_NAME } from '../lib/healthShortcut';

/** Runs the Send to Pilot Shortcut (phone unlocked, so Health can be read). */
export function UpdateHealthButton({ variant = 'quiet' }: { variant?: 'quiet' | 'full' }) {
  return (
    <button
      type="button"
      className={variant === 'full' ? 'button wide' : 'button quiet small update-health'}
      onClick={runHealthShortcut}
      aria-label={`Update health data (runs your ${SHORTCUT_NAME} Shortcut)`}
    >
      {variant === 'full' ? 'Update health data now' : '↻ Update'}
    </button>
  );
}
