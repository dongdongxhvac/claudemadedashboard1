// Shared cluster lookup for every Binney surface that prints a name — by
// user_id or by any spelling (full name, CMMS name, a sheet nickname such as
// "Herb" / "Rick" / "Harry"). engineer_profiles.cluster / manager_user_id
// (0154) via useAllUsers.
import { useMemo } from 'react';
import { useAllUsers, type EngineerRow } from './useBinneyEngineers';
import { useShifts } from '../../../hooks/useShifts';
import { resolveName, type Cluster, type Crew, type NameTarget } from '../../../lib/binneyRounds';

export type ClusterInfo = { cluster: Cluster | null; managerName: string | null };

export type ClusterPerson = NameTarget & EngineerRow;

export type ClusterIndex = {
  byUserId: Map<string, ClusterInfo>;
  /** lower-cased full_name and cmms_assignee_name → info */
  byName: Map<string, ClusterInfo>;
  managers: Record<Cluster, EngineerRow[]>;
  people: ClusterPerson[];
  /** Cluster + manager for any name spelling (full name, CMMS name, or a
   *  sheet nickname like "Herb" / "Rick"). */
  lookup: (name: string | null | undefined, crewHint?: Crew) => ClusterInfo | null;
  resolve: (name: string, crewHint?: Crew) => ClusterPerson | null;
  loading: boolean;
};

/** One shared lookup for every Binney surface that prints a name. */
export function useBinneyClusterIndex(): ClusterIndex {
  const q = useAllUsers();
  const shiftsQ = useShifts();
  const data = q.data;
  const shifts = shiftsQ.data;
  const loading = q.isLoading;
  return useMemo(() => {
    const users = data ?? [];
    const crewByShift = new Map<string, Crew>((shifts ?? []).map((s) => [s.id, s.crew ?? null]));
    const nameById = new Map(users.map((u) => [u.user_id, u.full_name]));
    const managers: Record<Cluster, EngineerRow[]> = { east: [], west: [] };
    for (const u of users) {
      if (u.active && u.role === 'manager' && u.cluster) managers[u.cluster].push(u);
    }
    const byUserId = new Map<string, ClusterInfo>();
    const byName = new Map<string, ClusterInfo>();
    const people: ClusterPerson[] = [];
    for (const u of users) {
      const managerName = u.manager_user_id
        ? nameById.get(u.manager_user_id) ?? null
        : u.cluster ? managers[u.cluster][0]?.full_name ?? null : null;
      const info: ClusterInfo = { cluster: u.cluster ?? null, managerName };
      byUserId.set(u.user_id, info);
      byName.set(u.full_name.toLowerCase(), info);
      if (u.cmms_assignee_name) byName.set(u.cmms_assignee_name.toLowerCase(), info);
      if (u.active) people.push({ ...u, crew: u.shift_id ? crewByShift.get(u.shift_id) ?? null : null });
    }
    const resolve = (name: string, crewHint?: Crew) => resolveName(name, people, crewHint);
    const lookup = (name: string | null | undefined, crewHint?: Crew) => {
      if (!name) return null;
      const direct = byName.get(name.trim().toLowerCase());
      if (direct) return direct;
      const p = resolve(name, crewHint);
      return p ? byUserId.get(p.user_id) ?? null : null;
    };
    return { byUserId, byName, managers, people, lookup, resolve, loading };
  }, [data, shifts, loading]);
}

