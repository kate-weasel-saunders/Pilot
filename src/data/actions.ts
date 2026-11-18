import { db } from './db';
import { deleteRow, saveRow } from './repo';
import { requestSync } from './syncController';
import type { CheckIn, Period, Tag } from './types';

/** App-level write actions: save locally, then nudge sync. */

export async function saveCheckIn(c: CheckIn) {
  const saved = await saveRow(db, 'check_ins', c);
  requestSync();
  return saved;
}
export async function removeCheckIn(id: string) {
  await deleteRow(db, 'check_ins', id);
  requestSync();
}
export async function savePeriod(p: Period) {
  const saved = await saveRow(db, 'periods', p);
  requestSync();
  return saved;
}
export async function removePeriod(id: string) {
  await deleteRow(db, 'periods', id);
  requestSync();
}
export async function saveTag(t: Tag) {
  const saved = await saveRow(db, 'tags', t);
  requestSync();
  return saved;
}
