import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { CheckIn, Period } from './types';

export const usePeriods = () => useLiveQuery(() => db.periods.orderBy('start_date').toArray(), [], [] as Period[]);

/** All check-ins, newest first. Data volume for one person stays small. */
export const useCheckIns = () =>
  useLiveQuery(() => db.check_ins.orderBy('observed_at').reverse().toArray(), [], undefined as CheckIn[] | undefined);

export const usePendingIds = () =>
  useLiveQuery(async () => new Set((await db.outbox.toArray()).map((e) => e.id)), [], new Set<string>());
