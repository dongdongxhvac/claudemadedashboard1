// Find-a-Cove-ID helper for Admin › User Profiles.
//
// The pm12/wo12 pollers only fetch tasks for engineers whose Cove user ID
// we know (engineer_profiles.cove_user_id, 0127). The ID is visible in Cove
// but buried: filter a task list by the person as Assignee and it's in the
// address bar inside a URL-encoded JSON blob like
//   …filters=%7B…%22id%22%3A%22DVQ8HxDTKS%22…%22firstName%22%3A%22Austin%22…
// — too long for a human to eyeball reliably (per user 2026-08-19). This
// panel takes whatever the admin pastes and does the squinting:
//
//   • the full Cove filter URL     → every assignee in it (id + name + email)
//   • a Cove profile URL /users/ID → that id
//   • a bare 10-char ID            → that id
//
// and offers a one-click "assign to <profile>" for each, pre-matching the
// Cove name against the roster's full_name / cmms_assignee_name so the
// default pick is almost always right. Writes via useUpdateEngineerProfile
// (same RLS as the drawer: admin any row, manager own-site engineers).
//
// Why not a live "directory of Cove users" instead? Cove has no member-list
// query in anything the pollers capture; the labor report returns names
// only. Reverse-engineering the picker's GQL needs a Cove session, which
// lives on the VM. Paste-and-parse works today with zero new surface.
import { useMemo, useState } from 'react';
import { useUpdateEngineerProfile, type EngineerRow } from '../hooks/useEngineers';
import { parseCoveIds, type CoveFound } from '../lib/coveId';

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/** Best roster match for a found Cove user: exact full-name or CMMS-name
 *  match first, then last-name match, then nothing. */
function suggestMatch(f: CoveFound, roster: EngineerRow[]): EngineerRow | null {
  const full = norm(`${f.firstName ?? ''}${f.lastName ?? ''}`);
  const last = norm(f.lastName);
  if (full) {
    const exact = roster.find((r) => norm(r.full_name) === full || norm(r.cmms_assignee_name) === full);
    if (exact) return exact;
  }
  if (f.email) {
    const byEmail = roster.find((r) => r.email && r.email.toLowerCase() === f.email!.toLowerCase());
    if (byEmail) return byEmail;
  }
  if (last) {
    const byLast = roster.filter((r) => norm(r.full_name).endsWith(last) || norm(r.cmms_assignee_name).endsWith(last));
    if (byLast.length === 1) return byLast[0];
  }
  return null;
}

export function CoveIdFinder({ roster, readOnly = false }: { roster: EngineerRow[]; readOnly?: boolean }) {
  const [raw, setRaw] = useState('');
  const [choice, setChoice] = useState<Record<string, string>>({}); // coveId → user_id
  const [done, setDone] = useState<Record<string, string>>({});     // coveId → user full_name
  const [err, setErr] = useState<string | null>(null);
  const update = useUpdateEngineerProfile();

  const found = useMemo(() => parseCoveIds(raw), [raw]);
  const engineers = useMemo(() => roster.filter((r) => r.role === 'engineer' && r.active), [roster]);
  const idOwner = useMemo(() => {
    const m = new Map<string, EngineerRow>();
    for (const r of roster) if (r.cove_user_id) m.set(r.cove_user_id, r);
    return m;
  }, [roster]);

  const missingCount = engineers.filter((e) => !e.cove_user_id).length;

  const assign = async (f: CoveFound) => {
    const userId = choice[f.id] ?? suggestMatch(f, engineers)?.user_id;
    if (!userId) return;
    setErr(null);
    try {
      await update.mutateAsync({ user_id: userId, patch: { cove_user_id: f.id } });
      const who = roster.find((r) => r.user_id === userId)?.full_name ?? 'profile';
      setDone((d) => ({ ...d, [f.id]: who }));
    } catch (e) {
      const msg = (e as Error).message;
      setErr(/duplicate|unique/i.test(msg)
        ? `That Cove ID is already on another profile (${idOwner.get(f.id)?.full_name ?? 'someone'}).`
        : msg);
    }
  };

  return (
    <div className="t-card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <h3 className="t-section-title" style={{ fontSize: '0.95rem' }}>
          Find a Cove ID
          {missingCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>
              {missingCount} engineer{missingCount === 1 ? '' : 's'} without one
            </span>
          )}
        </h3>
        <span className="t-small t-muted">
          Engineers without a Cove ID don't get their PMs/WOs pulled into the dashboard.
        </span>
      </div>

      <p className="t-small t-muted mb-2">
        In Cove, open <b>Maintenance › Open Tasks</b>, click <b>Filter → Assignee</b>, pick the person,
        then copy the whole address-bar URL and paste it here. (A Cove profile link or the bare ID works too.)
      </p>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Paste the Cove URL here — https://manage.cove.is/networks/…/pm-tasks?filters=%7B%22status%22…"
        rows={2}
        spellCheck={false}
        className="w-full border rounded px-2 py-1 t-text t-mono"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', fontSize: 11, resize: 'vertical' }}
      />

      {raw.trim() && found.length === 0 && (
        <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>
          No Cove ID found in that text. Make sure the URL has an Assignee filter applied (it should contain <code>%22id%22</code>).
        </p>
      )}

      {found.length > 0 && (
        <div className="mt-3 space-y-2">
          {found.map((f) => {
            const name = [f.firstName, f.lastName].filter(Boolean).join(' ') || null;
            const owner = idOwner.get(f.id);
            const suggested = suggestMatch(f, engineers);
            const selected = choice[f.id] ?? suggested?.user_id ?? '';
            const finished = done[f.id];
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 flex-wrap px-3 py-2 rounded border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-baseline gap-2">
                    <span className="t-mono font-semibold">{f.id}</span>
                    {name && <span className="t-text">{name}</span>}
                    {f.role && <span className="t-small t-muted">· {f.role.replace(/-/g, ' ')}</span>}
                  </div>
                  {f.email && <div className="t-small t-muted t-mono">{f.email}</div>}
                  {owner && !finished && (
                    <div className="t-small mt-0.5" style={{ color: 'var(--color-ok)' }}>
                      ✓ Already on <b>{owner.full_name}</b>'s profile
                    </div>
                  )}
                </div>

                {finished ? (
                  <span className="t-small font-medium" style={{ color: 'var(--color-ok)' }}>
                    ✓ Saved to {finished}
                  </span>
                ) : owner ? null : readOnly ? (
                  <span className="t-small t-muted">view only</span>
                ) : (
                  <>
                    <select
                      value={selected}
                      onChange={(e) => setChoice((c) => ({ ...c, [f.id]: e.target.value }))}
                      className="t-small border rounded px-2 py-1"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 180 }}
                    >
                      <option value="">— pick engineer —</option>
                      {engineers.map((e) => (
                        <option key={e.user_id} value={e.user_id}>
                          {e.full_name}{e.cove_user_id ? ' (has ID)' : ''}
                        </option>
                      ))}
                    </select>
                    {suggested && selected === suggested.user_id && (
                      <span className="t-small t-muted" title="Matched by name">auto-matched</span>
                    )}
                    <button
                      type="button"
                      disabled={!selected || update.isPending}
                      onClick={() => assign(f)}
                      className="t-small px-3 py-1 rounded border font-medium text-white disabled:opacity-40"
                      style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
                    >
                      {update.isPending ? 'Saving…' : 'Assign'}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}
