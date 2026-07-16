// Manager-editable pto_cal_recipients — TWO lists per site since migration
// 0102 added `kind` (read by notify-pto v19):
//   kind='feed'   — SHARED calendar sync inboxes. Binney: the Power Automate
//                   feed (jie.lao) — a body-only PTO_DATA email goes here and
//                   the PA flow writes the event onto the M365 group
//                   calendar. ADMIN-ONLY writes (RLS + UI). Emptying it
//                   silently kills the group calendar sync — no fallback.
//   kind='invite' — PERSONAL calendar .ics extras, on top of the built-in
//                   home managers (+ requester at UPark). admin/manager
//                   writes. At Binney these are muted until launch
//                   (BINNEY_LIVE switch in the edge function).
//
// Rendered by BOTH the UPark and Binney PTO panels with their site code.
// Additive shared component: self-contained queries/mutations, no shared
// hooks touched (isolate-new-features rule).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../hooks/useMe';

type Row = { id: string; email: string; note: string | null; kind: 'feed' | 'invite' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '0.15rem 0.5rem', borderRadius: 999,
  border: '1px solid var(--color-border)', background: 'var(--color-card)',
};

function Chips({ rows, canEdit, onRemove, removing }: {
  rows: Row[]; canEdit: boolean; onRemove: (id: string) => void; removing: boolean;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {rows.map((r) => (
        <li key={r.id} className="t-small" style={chipStyle}>
          <span>{r.email}</span>
          {r.note && <span className="t-muted">· {r.note}</span>}
          {canEdit && (
            <button
              type="button"
              onClick={() => onRemove(r.id)}
              disabled={removing}
              className="t-muted hover:t-danger"
              title="Remove recipient"
              style={{ fontSize: 14, lineHeight: 1 }}
            >×</button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddRow({ rows, pending, error, onAdd }: {
  rows: Row[]; pending: boolean; error: Error | null;
  onAdd: (email: string, note: string, done: () => void) => void;
}) {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const validEmail = EMAIL_RE.test(email.trim());
  const dup = rows.some((r) => r.email.toLowerCase() === email.trim().toLowerCase());
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@company.com"
        className="border rounded px-2 py-1 t-small"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 220 }}
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        className="border rounded px-2 py-1 t-small"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 140 }}
      />
      <button
        type="button"
        onClick={() => onAdd(email, note, () => { setEmail(''); setNote(''); })}
        disabled={!validEmail || dup || pending}
        title={dup ? 'Already in the list' : !validEmail ? 'Enter a valid email' : undefined}
        className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--color-accent)' }}
      >
        {pending ? 'Adding…' : '+ Add'}
      </button>
      {error && <span className="t-small t-danger">{error.message}</span>}
    </div>
  );
}

export function PtoCalRecipientsEditor({ siteCode }: { siteCode: 'upark' | 'binney' }) {
  const qc = useQueryClient();
  const LIST_KEY = ['pto_cal_recipients', siteCode];
  const isBinney = siteCode === 'binney';
  const isAdmin = useIsAdmin();

  const siteQ = useQuery({
    queryKey: ['pto_cal_site_id', siteCode],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('sites').select('id').eq('code', siteCode).maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    staleTime: Infinity,
  });

  const listQ = useQuery({
    queryKey: [...LIST_KEY, siteQ.data ?? null],
    enabled: !!siteQ.data,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('pto_cal_recipients')
        .select('id, email, note, kind')
        .eq('site_id', siteQ.data!)
        .order('email');
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 30_000,
  });

  // Built-in defaults summary: this site's managers (named — short list) and
  // the engineer count (UPark shows it; each invite goes to the one
  // requesting engineer).
  const defaultsQ = useQuery({
    queryKey: ['pto_cal_defaults', siteCode, siteQ.data ?? null],
    enabled: !!siteQ.data,
    queryFn: async (): Promise<{ managers: string[]; engineerCount: number }> => {
      const { data, error } = await supabase
        .from('users')
        .select('full_name, is_manager, role, active, engineer_profiles!inner(home_site_id)')
        .eq('engineer_profiles.home_site_id', siteQ.data!)
        .eq('active', true);
      if (error) throw error;
      const rows = (data ?? []) as { full_name: string; is_manager: boolean; role: string }[];
      return {
        managers: rows.filter((r) => r.is_manager).map((r) => r.full_name).sort(),
        engineerCount: rows.filter((r) => r.role === 'engineer').length,
      };
    },
    staleTime: 60_000,
  });

  const add = useMutation({
    mutationFn: async (input: { email: string; note: string | null; kind: 'feed' | 'invite' }) => {
      const { error } = await supabase.from('pto_cal_recipients').insert({
        site_id: siteQ.data!,
        email: input.email.trim().toLowerCase(),
        note: input.note?.trim() || null,
        kind: input.kind,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pto_cal_recipients').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });

  const [open, setOpen] = useState(false);
  const rows = listQ.data ?? [];
  const feedRows = rows.filter((r) => r.kind === 'feed');
  const inviteRows = rows.filter((r) => r.kind !== 'feed');
  const managerNames = defaultsQ.data?.managers ?? [];

  const onAdd = (kind: 'feed' | 'invite') => (email: string, note: string, done: () => void) => {
    if (!siteQ.data) return;
    add.mutate({ email, note, kind }, { onSuccess: done });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="t-small t-muted uppercase tracking-wider hover:t-accent"
        title={isBinney
          ? 'Shared calendar sync feed (admin-only) + personal invite list (muted until launch)'
          : 'Invites go to home-site managers + the requesting engineer by default; extras (client / director / admin) are added below'}
      >
        {open ? '▾' : '▸'} {isBinney
          ? `PTO calendar · ${feedRows.length} sync inbox${feedRows.length === 1 ? '' : 'es'} · ${managerNames.length + inviteRows.length} personal`
          : `Calendar invites · ${defaultsQ.data?.managers.length ?? '…'} managers · ${defaultsQ.data?.engineerCount ?? '…'} engineers · ${inviteRows.length} extras`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {siteQ.data === null && !siteQ.isLoading && (
            <p className="t-small t-danger">Site row missing — cannot edit.</p>
          )}
          {isBinney ? (
            <>
              {/* ── Shared calendar (PA feed) — admin-only ─────────────── */}
              <p className="t-small t-muted" style={{ marginBottom: 4 }}>
                <strong>Shared calendar sync ({feedRows.length})</strong> — admin only. A
                body-only sync email goes to these inboxes; Power Automate writes the event
                onto the group calendar. <strong>Not an invite list</strong> — emptying it
                turns the shared calendar sync off.
                {feedRows.length === 0 && (
                  <span className="t-danger"> Sync is OFF — no feed inbox configured.</span>
                )}
              </p>
              <Chips rows={feedRows} canEdit={isAdmin} onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />
              {isAdmin
                ? <AddRow rows={feedRows} pending={add.isPending} error={add.error as Error | null} onAdd={onAdd('feed')} />
                : <p className="t-small t-muted" style={{ fontStyle: 'italic' }}>Only an admin can edit the sync list.</p>}

              {/* ── Personal calendar invites ──────────────────────────── */}
              <p className="t-small t-muted" style={{ margin: '10px 0 4px' }}>
                <strong>Personal calendar invites ({managerNames.length + inviteRows.length})</strong> —
                a real .ics invite that books each person's own Outlook calendar.
                Home managers ({managerNames.join(', ') || '—'}) are always included; extras
                below. <strong>Muted in develop mode</strong> (BINNEY_LIVE) — nothing sends
                until launch.
              </p>
              <Chips rows={inviteRows} canEdit onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />
              <AddRow rows={inviteRows} pending={add.isPending} error={add.error as Error | null} onAdd={onAdd('invite')} />
            </>
          ) : (
            <>
              <p className="t-small t-muted">
                <strong>Managers ({defaultsQ.data?.managers.length ?? 0})</strong>:{' '}
                {defaultsQ.data?.managers.join(', ') || '—'}
                {' · '}
                <strong>Engineers ({defaultsQ.data?.engineerCount ?? 0})</strong>: each invite
                goes to the engineer whose PTO it is
                {' · '}
                <strong>Extras ({inviteRows.length})</strong>: added below — any inbox, gets
                every invite and cancellation.
              </p>
              <Chips rows={inviteRows} canEdit onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />
              <AddRow rows={inviteRows} pending={add.isPending} error={add.error as Error | null} onAdd={onAdd('invite')} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
