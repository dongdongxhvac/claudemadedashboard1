// /engineer/:id/profile — the RPG-styled engineer profile sub-page.
// Per plan: the ONLY RPG-styled screen in the app. Independent of the
// V5/Linear theme tokens (always RPG).
//
// Access: admin/manager can view any; engineer can view own iff
// visible_to_self=true; otherwise RLS returns no row → friendly 403 message.
import { Link, useParams } from 'react-router-dom';
import { useEngineerProfile, type CompletionEntry } from '../../hooks/useEngineerProfile';
import { useMe } from '../../hooks/useMe';
import { DISCIPLINES, type Discipline } from '../../hooks/useEngineers';

// ----- level → tier visuals -----
const TIERS = [
  { range: [1, 2],  label: 'APPRENTICE', bg: '#475569', glow: 'rgba(71, 85, 105, 0.45)' },
  { range: [3, 4],  label: 'JOURNEYMAN', bg: '#b45309', glow: 'rgba(180, 83, 9, 0.45)' },
  { range: [5, 6],  label: 'SENIOR',     bg: '#475569', glow: 'rgba(148, 163, 184, 0.6)' },
  { range: [7, 8],  label: 'EXPERT',     bg: '#ca8a04', glow: 'rgba(202, 138, 4, 0.55)' },
  { range: [9, 10], label: 'MASTER',     bg: '#7c3aed', glow: 'rgba(124, 58, 237, 0.55)' },
] as const;
function tierFor(level: number) {
  return TIERS.find((t) => level >= t.range[0] && level <= t.range[1]) ?? TIERS[0];
}

// ----- XP progress within current level -----
function xpProgress(xp: number, level: number) {
  const prev = Math.pow(level - 1, 2) * 100;
  const next = Math.pow(level, 2) * 100;
  const pctNum = level >= 10 ? 100 : Math.min(100, Math.max(0, ((xp - prev) / (next - prev)) * 100));
  return { prev, next, pct: pctNum, toNext: Math.max(0, next - xp) };
}

// ----- 5-branch skill tree (current data is single-discipline; show that + locks for others) -----
const BRANCHES: { key: Discipline; label: string; emoji: string }[] = [
  { key: 'M',   label: 'Mechanical',     emoji: '⚙️' },
  { key: 'E',   label: 'Electrical',     emoji: '⚡' },
  { key: 'P',   label: 'Plumbing',       emoji: '💧' },
  { key: 'BMS', label: 'BMS',            emoji: '🖥️' },
  { key: 'FLS', label: 'Fire / Safety',  emoji: '🧯' },
];

export default function EngineerProfile() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const q = useEngineerProfile(id);

  if (q.isLoading || me.isLoading) return <Wrap><p>Loading...</p></Wrap>;
  if (q.isError) return <Wrap><p style={{ color: '#fecaca' }}>Error: {(q.error as Error).message}</p></Wrap>;

  // RLS returned no row → either not an engineer, doesn't exist, or self with visible_to_self=false.
  if (!q.data || !q.data.profile) {
    const isSelf = me.data && id === me.data.id;
    return (
      <Wrap>
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-medium mb-2">Profile not available</h2>
          <p className="opacity-70">
            {isSelf
              ? 'Your profile is being set up by your admin. It will appear here once ready.'
              : 'This profile is private or has not been set up.'}
          </p>
          <Link to="/manager" className="inline-block mt-6 underline opacity-80 hover:opacity-100">← Back to dashboard</Link>
        </div>
      </Wrap>
    );
  }

  const { profile: p, completions } = q.data;
  const tier = tierFor(p.level);
  const prog = xpProgress(p.xp, p.level);
  const initials = p.full_name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Wrap>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <nav className="mb-6 text-sm opacity-70">
          <Link to="/manager" className="hover:opacity-100">Dashboard</Link>
          {me.data?.role === 'admin' && <> · <Link to="/admin" className="hover:opacity-100">Admin</Link></>}
        </nav>

        {/* ---- Header card ------------------------------------------------ */}
        <header className="rounded-2xl p-8 mb-8 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
            boxShadow: `0 0 80px ${tier.glow} inset`,
          }}
        >
          <div className="flex items-center gap-6">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold shrink-0"
              style={{ background: tier.bg, boxShadow: `0 0 30px ${tier.glow}` }}
            >
              {initials}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                <h1 className="text-3xl font-medium tracking-tight">{p.full_name}</h1>
                {p.discipline && (
                  <span className="text-xs uppercase tracking-widest px-2 py-1 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}>
                    {DISCIPLINES.find((d) => d.value === p.discipline)?.label ?? p.discipline}
                  </span>
                )}
              </div>
              <p className="text-sm opacity-60">{p.cmms_assignee_name ?? '—'}{p.hiring_date && ` · hired ${p.hiring_date}`}</p>

              <div className="mt-4 flex items-center gap-4">
                <div className="px-3 py-1 rounded-md font-mono text-sm" style={{ background: tier.bg }}>
                  LVL {p.level}
                </div>
                <span className="text-xs uppercase tracking-widest opacity-70">{tier.label}</span>
                <span className="font-mono text-sm opacity-80">{p.xp.toLocaleString()} XP</span>
              </div>

              {/* XP bar */}
              <div className="mt-4">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${prog.pct}%`,
                      background: `linear-gradient(90deg, ${tier.bg}, #a78bfa)`,
                      boxShadow: `0 0 10px ${tier.glow}`,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs opacity-60 font-mono">
                  <span>{prog.prev.toLocaleString()} XP</span>
                  <span>
                    {p.level >= 10
                      ? 'MAX LEVEL'
                      : `${prog.toNext.toLocaleString()} XP to LVL ${p.level + 1}`}
                  </span>
                  <span>{prog.next.toLocaleString()} XP</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ---- Skill tree ------------------------------------------------- */}
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">Skill tree</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {BRANCHES.map((b) => {
              const isPrimary = p.discipline === b.key;
              const branchLevel = isPrimary ? p.level : 0;
              const branchXp = isPrimary ? p.xp : 0;
              return (
                <div
                  key={b.key}
                  className="rounded-xl p-4 text-center transition-opacity"
                  style={{
                    background: isPrimary
                      ? 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)'
                      : 'rgba(255,255,255,0.03)',
                    border: isPrimary ? `1px solid ${tier.bg}` : '1px solid rgba(255,255,255,0.06)',
                    boxShadow: isPrimary ? `0 0 30px ${tier.glow}` : 'none',
                    opacity: isPrimary ? 1 : 0.45,
                  }}
                >
                  <div className="text-3xl mb-2">{b.emoji}</div>
                  <div className="text-sm font-medium">{b.label}</div>
                  <div className="mt-2 font-mono text-xs opacity-80">
                    LVL {branchLevel} · {branchXp.toLocaleString()} XP
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs opacity-50 mt-3 italic">
            Currently single-branch. Multi-discipline XP and per-branch perks land in a later iteration.
          </p>
        </section>

        {/* ---- Badges ----------------------------------------------------- */}
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">Badges</h2>
          {p.badges.length === 0 ? (
            <p className="opacity-50 italic text-sm">No badges yet — earn one by signing off your first SOP.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {p.badges.map((b, i) => (
                <span key={i} className="px-3 py-1 rounded-full text-xs"
                  style={{ background: 'rgba(124, 58, 237, 0.2)', color: '#c4b5fd' }}>
                  {String(b)}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ---- Completion history ---------------------------------------- */}
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">
            Recent completions <span className="opacity-60">· {completions.length}</span>
          </h2>
          {completions.length === 0 ? (
            <p className="opacity-50 italic text-sm">No completions tracked yet.</p>
          ) : (
            <CompletionList rows={completions} />
          )}
        </section>

        {/* ---- Admin/Manager-only notes ---------------------------------- */}
        {p.notes && (me.data?.role === 'admin' || me.data?.role === 'manager') && (
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">
              Notes <span className="opacity-60 italic">(admin/manager only)</span>
            </h2>
            <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="whitespace-pre-wrap opacity-90">{p.notes}</p>
            </div>
          </section>
        )}
      </div>
    </Wrap>
  );
}

function CompletionList({ rows }: { rows: CompletionEntry[] }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-widest opacity-50">
            <th className="text-left py-2 px-4">Task #</th>
            <th className="text-left py-2 px-4">Type</th>
            <th className="text-right py-2 px-4">Labor h</th>
            <th className="text-right py-2 px-4">First seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.task_no}-${i}`} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
              <td className="py-2 px-4 font-mono text-xs">{r.task_no}</td>
              <td className="py-2 px-4 text-xs">{r.pm_type ?? '—'}</td>
              <td className="py-2 px-4 text-right font-mono text-xs">{r.labor_hours ?? '—'}</td>
              <td className="py-2 px-4 text-right font-mono text-xs opacity-70">
                {new Date(r.first_seen_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen text-white"
      style={{
        background:
          'radial-gradient(ellipse at top, #1e1b4b 0%, #0a0a0f 60%), #0a0a0f',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {children}
    </div>
  );
}
