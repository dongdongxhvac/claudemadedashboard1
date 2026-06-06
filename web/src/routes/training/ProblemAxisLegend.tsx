import { PROBLEM_TYPE_META } from './trainingSections';

/** Compact legend for the problem skill axes — the supervisor's own definitions,
 *  rendered above the problem library and the per-tech proficiency table so the
 *  meaning of each axis is unambiguous in the UI. */
export function ProblemAxisLegend() {
  return (
    <div
      className="t-small t-muted"
      style={{
        marginBottom: 10, lineHeight: 1.55, padding: '8px 10px',
        border: '1px solid var(--color-border-soft)', borderRadius: 4,
        background: 'var(--color-card-elevated, rgba(0,0,0,0.02))',
      }}
    >
      {PROBLEM_TYPE_META.map((m) => (
        <div key={m.key}>
          <b style={{ color: 'var(--color-text)' }}>{m.label}</b> — {m.blurb}
        </div>
      ))}
    </div>
  );
}
