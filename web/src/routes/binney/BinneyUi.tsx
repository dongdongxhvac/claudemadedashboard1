// Tiny shared bits for the Binney ops section (0154 panels).
import type { ReactNode } from 'react';
import type { ClusterPerson } from './hooks/useBinneyClusterIndex';
import { inputStyle, type Cluster, type Crew } from '../../lib/binneyRounds';

const CREW_SHORT: Record<'sunday' | 'saturday' | 'none', string> = { sunday: 'Sun–Wed', saturday: 'Wed–Sat', none: 'Mon–Fri' };

/** Pop-up picker of people. Default: grouped by cluster (the column's own
 *  cluster first when `clusterFirst` is set, else East, then West, then no
 *  cluster), alphabetical inside each, crew in the label. `crews` keeps only
 *  the crews that work that day (null = the Mon–Fri shift). `order:
 *  'seniority'` is a flat list by hire date (earliest first) with the hire
 *  month shown — the shadow row. `role` picks engineers (default) or
 *  managers. Used by the rounds rotation editor and the weekend plan editor. */
export function EngineerSelect({
  value, onChange, people, crews, clusterFirst, order = 'name', role = 'engineer', showCrew = true, placeholder = '—', heading,
}: {
  /** First line of the open menu, e.g. "Week A · Monday · Cluster E1" — the
   *  menu covers the cell it belongs to, so it says what is being picked. */
  heading?: string;
  value: string;
  onChange: (userId: string) => void;
  people: ClusterPerson[];
  crews?: Crew[];
  clusterFirst?: Cluster | null;
  order?: 'name' | 'seniority';
  role?: 'engineer' | 'manager';
  showCrew?: boolean;
  placeholder?: string;
}) {
  const list = people.filter((p) => p.role === role && (!crews || crews.includes(p.crew ?? null)));
  const byName = (a: ClusterPerson, b: ClusterPerson) => a.full_name.localeCompare(b.full_name);
  const bySeniority = (a: ClusterPerson, b: ClusterPerson) => {
    if (a.hiring_date && b.hiring_date && a.hiring_date !== b.hiring_date) return a.hiring_date < b.hiring_date ? -1 : 1;
    if (!!a.hiring_date !== !!b.hiring_date) return a.hiring_date ? -1 : 1;
    return byName(a, b);
  };
  const hired = (p: ClusterPerson) => (p.hiring_date
    ? ` · hired ${new Date(p.hiring_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
    : ' · hire date —');
  const labelOf = (p: ClusterPerson) =>
    `${p.is_lead ? '★ ' : ''}${p.full_name}${showCrew ? ` · ${CREW_SHORT[p.crew ?? 'none']}` : ''}${order === 'seniority' ? hired(p) : ''}`;

  const option = (p: ClusterPerson) => <option key={p.user_id} value={p.user_id}>{labelOf(p)}</option>;

  let body: ReactNode;
  if (order === 'seniority') {
    body = [...list].sort(bySeniority).map(option);
  } else {
    const clusterOrder: (Cluster | null)[] = clusterFirst
      ? [clusterFirst, clusterFirst === 'east' ? 'west' : 'east', null]
      : ['east', 'west', null];
    const label: Record<string, string> = { east: 'East', west: 'West', none: 'No cluster' };
    body = clusterOrder
      .map((c) => ({ c, list: list.filter((p) => (p.cluster ?? null) === c).sort(byName) }))
      .filter((g) => g.list.length > 0)
      .map((g) => <optgroup key={g.c ?? 'none'} label={label[g.c ?? 'none']}>{g.list.map(option)}</optgroup>);
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={heading}
      className="w-full border rounded px-1 t-small t-text" style={{ ...inputStyle, minWidth: 0, fontSize: 11 }}>
      {heading && <option disabled value="__heading">▸ {heading}</option>}
      <option value="">{placeholder}</option>
      {body}
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
