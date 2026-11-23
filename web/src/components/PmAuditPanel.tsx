// §05 — PM audit, the manager dashboard's doorway into /audit (queue, review
// card, scorecard — docs/pm-audit.md). Shows where this site's weekly review
// stands; the work itself happens on the audit pages.
import { Link } from 'react-router-dom';
import { Section } from './Section';
import { useAuditAccess, useAuditQueue, useAuditWeekRange } from '../hooks/usePmAudit';
import { auditWeekLabel, type AuditSite } from '../lib/pmAudit';

export function PmAuditPanel({ siteCode }: { siteCode: AuditSite }) {
  const access = useAuditAccess();
  const range = useAuditWeekRange();
  const week = range.data?.latest ?? null;
  const queueQ = useAuditQueue(access.canView ? week : null, siteCode);
  if (!access.canView) return null;

  const rows = queueQ.data ?? [];
  const open = rows.filter((r) => !r.review).length;
  const flagged = rows.filter((r) => r.reason === 'flagged').length;
  const good = rows.filter((r) => r.reason === 'good').length;
  const qs = access.canPickSite ? `?site=${siteCode}` : '';

  return (
    <Section
      title="§05 PM audit"
      id="sec-pm-audit"
      subtitle={week ? `week of ${auditWeekLabel(week, siteCode)}` : undefined}
      loading={range.isLoading || queueQ.isLoading}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="t-text">
          {!week ? (
            <span className="t-muted">No queue yet — the first one is built Sunday 23:05 ET.</span>
          ) : rows.length === 0 ? (
            <span className="t-muted">Nothing queued for this site that week.</span>
          ) : (
            <>
              <span className={`t-mono ${open > 0 ? 't-warn' : ''}`} style={{ fontWeight: 600 }}>{open}</span> to review
              <span className="t-muted"> · {rows.length} queued ({flagged} flagged, {good} good, {rows.length - flagged - good} random) · {rows.length - open} reviewed</span>
            </>
          )}
        </p>
        <div className="flex items-center gap-4">
          <Link to={`/audit${qs}`} className="t-small t-accent hover:underline">Review queue →</Link>
          <Link to={`/audit/scorecard${qs}`} className="t-small t-accent hover:underline">Scorecard →</Link>
        </div>
      </div>
    </Section>
  );
}
