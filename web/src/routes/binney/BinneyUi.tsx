// Tiny shared bits for the Binney ops section (0154 panels).
import type { ReactNode } from 'react';
import type { ClusterPerson } from './hooks/useBinneyClusterIndex';
import { inputStyle, type Cluster, type Crew } from '../../lib/binneyRounds';

const CREW_SHORT: Record<'sunday' | 'saturday' | 'none', string> = { sunday: 'Sun–Wed', saturday: 'Wed–Sat', none: 'Mon–Fri' };

/** Pop-up picker of people grouped by cluster (East, then West, then no
 *  cluster), alphabetical inside each, crew in the label. Used by the rounds
 *  rotation editor and the weekend plan editor. `crew` narrows to one crew
 *  (Wednesday's two slots); `role` picks engineers (default) or managers. */
export function EngineerSelect({
  value, onChange, people, crew, role = 'engineer', showCrew = true, placeholder = '—',
}: {
  value: string;
  onChange: (userId: string) => void;
  people: ClusterPerson[];
  crew?: Crew;
  role?: 'engineer' | 'manager';
  showCrew?: boolean;
  placeholder?: string;
}) {
  const list = people.filter((p) => p.role === role && (!crew || p.crew === crew));
  const byCluster = (c: Cluster | null) =>
    list.filter((p) => (p.cluster ?? null) === c).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const groups = [
    { label: 'East', list: byCluster('east') },
    { label: 'West', list: byCluster('west') },
    { label: 'No cluster', list: byCluster(null) },
  ].filter((g) => g.list.length > 0);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full border rounded px-1 t-small t-text" style={{ ...inputStyle, minWidth: 0, fontSize: 11 }}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.list.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.is_lead ? '★ ' : ''}{p.full_name}{showCrew ? ` · ${CREW_SHORT[p.crew ?? 'none']}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function SmallBtn({
  children, onClick, disabled, title, primary, danger,
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; primary?: boolean; danger?: boolean;
}) {
  const style = primary
    ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'white', fontWeight: 600 }
    : danger
      ? { color: 'var(--color-danger)', borderColor: 'var(--color-danger)', background: 'transparent' }
      : { color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' };
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="t-small px-2 py-0.5 rounded border disabled:opacity-50" style={style}>
      {children}
    </button>
  );
}
