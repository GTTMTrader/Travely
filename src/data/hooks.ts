import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from './auth';
import { getAuth } from './backend';
import { watchInvites, watchMyTrips, watchTrip, type TripWatch } from './repo';
import type { Day, Invite, Item, Role, Trip } from '../lib/types';
import { sortItems } from '../lib/order';

export function useUser(): { user: AppUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: AppUser | null; loading: boolean }>({ user: null, loading: true });
  useEffect(() => getAuth().onUser((u) => setState({ user: u, loading: false })), []);
  return state;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const syncKey = (id: string) => `travely:lastSync:${id}`;
export function readLastSync(tripId: string): number | null {
  try {
    const v = localStorage.getItem(syncKey(tripId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function useTrip(tripId: string, uid: string | undefined): TripWatch & { lastSync: number | null } {
  const [w, setW] = useState<TripWatch>({ status: 'loading' });
  const [lastSync, setLastSync] = useState<number | null>(() => readLastSync(tripId));
  useEffect(() => {
    if (!uid) return;
    setW({ status: 'loading' });
    return watchTrip(tripId, (next) => {
      setW(next);
      if (next.status === 'ready' && next.live && !next.pending) {
        const now = Date.now();
        setLastSync(now);
        try {
          localStorage.setItem(syncKey(tripId), String(now));
        } catch {
          /* 무시 */
        }
      }
    });
  }, [tripId, uid]);
  return { ...w, lastSync };
}

export function useMyTrips(uid: string | undefined) {
  const [rows, setRows] = useState<{ trip: Trip; role: Role; memberCount: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    return watchMyTrips(uid, (r, e) => {
      if (e) setErr(e);
      else setRows(r);
    });
  }, [uid]);
  return { rows, err };
}

export function useInvites(tripId: string, enabled: boolean): Invite[] {
  const [inv, setInv] = useState<Invite[]>([]);
  useEffect(() => (enabled ? watchInvites(tripId, setInv) : undefined), [tripId, enabled]);
  return inv;
}

/** 날짜별 정렬된 일정 + 후보 장소(null 키) */
export function useItemsByDay(items: Item[], days: Day[]) {
  return useMemo(() => {
    const by = new Map<string | null, Item[]>();
    days.forEach((d) => by.set(d.date, []));
    by.set(null, []);
    for (const it of items) {
      const k = it.dayId && by.has(it.dayId) ? it.dayId : it.dayId ? it.dayId : null;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(it);
    }
    for (const [k, v] of by) by.set(k, sortItems(v));
    return by;
  }, [items, days]);
}
