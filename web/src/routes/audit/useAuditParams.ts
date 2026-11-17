// §05 PM Audit — the section's state lives in the address (site, week,
// queue filters), so the review card can walk "the same filter" the queue
// showed and a shared link opens the same view.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuditAccess } from '../../hooks/usePmAudit';
import { isWeekStart, parseFlag, parsePill, type QueueFilter, type SiteFilter } from '../../lib/pmAudit';

export function useAuditParams(): {
  site: SiteFilter;
  /** ?week= on the queue page (null = the latest queued week). */
  week: string | null;
  filter: QueueFilter;
  /** "?site=…&f=…" carrying site + queue filters (never the week). */
  carry: string;
  set: (changes: Record<string, string | null>) => void;
} {
  const [sp, setSp] = useSearchParams();
  const access = useAuditAccess();

  const raw = sp.get('site');
  const site: SiteFilter = !access.canPickSite
    ? access.homeSite
    : raw === 'upark' || raw === 'binney' ? raw : 'both';

  const weekRaw = sp.get('week');
  const week = isWeekStart(weekRaw) ? weekRaw : null;
  const pill = parsePill(sp.get('f'));
  const tech = sp.get('tech') ?? '';
  const flag = parseFlag(sp.get('flag'));
  const filter = useMemo<QueueFilter>(() => ({ pill, tech, flag }), [pill, tech, flag]);

  const carry = useMemo(() => {
    const out = new URLSearchParams();
    for (const k of ['site', 'f', 'tech', 'flag']) {
      const v = sp.get(k);
      if (v) out.set(k, v);
    }
    const s = out.toString();
    return s ? `?${s}` : '';
  }, [sp]);

  const set = useCallback((changes: Record<string, string | null>) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '') next.delete(k); else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }, [setSp]);

  return { site, week, filter, carry, set };
}
