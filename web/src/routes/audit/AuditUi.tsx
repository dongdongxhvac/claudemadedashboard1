// §05 PM Audit — shared pieces of the three screens: the page shell (section
// header, Queue / Scorecard tabs, site toggle), chips, tiles, bars.
import type { CSSProperties, ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuditAccess } from '../../hooks/usePmAudit';
import { SITE_LABEL, VERDICT_LABEL, type Chip, type SiteFilter, type Verdict } from '../../lib/pmAudit';
import { A, CHIP_TONE, VERDICT_TONE, cardStyle, font, labelStyle } from './auditTheme';
import { useAuditParams } from './useAuditParams';

/** Route gate: the audit is for admin / manager / director / lead (the same
 *  people RLS lets read the queue). Everyone else goes home. */
export function RequireAudit({ children }: { children: ReactNode }) {
  const access = useAuditAccess();
  if (access.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!access.canView) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 4, background: A.card, border: `1px solid ${A.line}`, borderRadius: 10, padding: 4, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            style={{ height: 36, padding: '0 14px', borderRadius: 7, border: 0, background: on ? A.ink : 'transparent', color: on ? '#FFFFFF' : A.ink, font: `500 13px ${font}`, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const SITE_OPTIONS: { value: SiteFilter; label: string }[] = [
  { value: 'upark', label: SITE_LABEL.upark },
  { value: 'binney', label: SITE_LABEL.binney },
  { value: 'both', label: SITE_LABEL.both },
];

/** Page frame. `kicker` is the small caps line ("Section 05"), `actions` sit
 *  right of the title. The site toggle shows for admin / director; a
 *  single-site viewer sees their site named instead. */
export function AuditShell({ kicker, title, subtitle, actions, children, tabs = true }: {
  kicker: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tabs?: boolean;
}) {
  const access = useAuditAccess();
  const p = useAuditParams();
  const { pathname } = useLocation();
  const onScorecard = pathname.startsWith('/audit/scorecard');
  const siteQs = p.site !== 'both' && access.canPickSite ? `?site=${p.site}` : '';
  const tab = (to: string, text: string, on: boolean) => (
    <Link to={to} aria-current={on ? 'page' : undefined}
      style={{ padding: '10px 2px', font: `600 14px ${font}`, color: on ? A.ink : A.muted, textDecoration: 'none', borderBottom: `2px solid ${on ? A.ink : 'transparent'}` }}>
      {text}
    </Link>
  );
  return (
    <div style={{ minHeight: '100vh', background: A.bg, fontFamily: font, color: A.ink }}>
      <div style={{ maxWidth: 1360, margin: '0 auto', boxSizing: 'border-box', padding: '20px clamp(16px, 3vw, 40px) 48px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${A.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <Link to="/" style={{ font: `500 13px ${font}`, color: A.blue, textDecoration: 'none' }}>← Dashboard</Link>
            {tabs && tab(`/audit${siteQs}`, 'Queue', !onScorecard)}
            {tabs && tab(`/audit/scorecard${siteQs}`, 'Scorecard', onScorecard)}
          </div>
          <div style={{ paddingBottom: 8 }}>
            {access.canPickSite
              ? <Segmented label="Site" value={p.site} options={SITE_OPTIONS} onChange={(v) => p.set({ site: v === 'both' ? null : v, tech: null })} />
              : <span style={{ fontSize: 13, color: A.muted }}>{SITE_LABEL[p.site]}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: A.muted }}>{kicker}</div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>{title}</h1>
            {subtitle && <div style={{ fontSize: 14, color: A.muted }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ChipTag({ chip }: { chip: Chip }) {
  const t = CHIP_TONE[chip.tone];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {chip.label}
    </span>
  );
}

export function VerdictTag({ verdict }: { verdict: Verdict }) {
  const t = VERDICT_TONE[verdict];
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {t.glyph} {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function StatTile({ label, value, valueColor, sub, children }: {
  label: string;
  value: ReactNode;
  valueColor?: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={{ ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, color: valueColor }}>{value}</div>
      {children}
      {sub && <div style={{ fontSize: 13, color: A.muted }}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, aside, children, style }: { title: ReactNode; aside?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ ...cardStyle, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Soft({ children }: { children: ReactNode }) {
  return <span style={{ fontWeight: 400, color: A.muted }}>{children}</span>;
}

/** One horizontal bar row: label · track · value. */
export function BarRow({ label, frac, value, color, valueColor }: { label: ReactNode; frac: number; value: string; color: string; valueColor?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) 1fr 48px', gap: 12, alignItems: 'center' }}>
      <span>{label}</span>
      <div style={{ height: 14, borderRadius: 3, background: A.track }}>
        <div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, height: '100%', borderRadius: 3, background: color }} />
      </div>
      <span style={{ textAlign: 'right', fontWeight: 600, color: valueColor }}>{value}</span>
    </div>
  );
}

export function Notice({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'error' }) {
  return (
    <div style={{ ...cardStyle, padding: '18px 20px', fontSize: 14, color: tone === 'error' ? A.redDark : A.muted, background: tone === 'error' ? A.redSoft : A.card }}>
      {children}
    </div>
  );
}
