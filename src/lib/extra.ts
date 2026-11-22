import type { CheckIn } from '../data/types';

/**
 * Optional fields kept in check_ins.extra (jsonb) while they settle, so new
 * things can be recorded without a database migration. Read and write them
 * only through these helpers.
 */

const MAX_PRESSURE_REASON = 500;

/** "What's the pressure coming from?", optional, alongside the Pressure / demand scale. */
export function pressureReason(c: Pick<CheckIn, 'extra'>): string | null {
  const v = c.extra?.pressure_reason;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Return `extra` with the pressure reason set (or removed when blank). */
export function withPressureReason(extra: Record<string, unknown>, reason: string): Record<string, unknown> {
  const next = { ...extra };
  const clean = reason.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESSURE_REASON);
  if (clean) next.pressure_reason = clean;
  else delete next.pressure_reason;
  return next;
}
