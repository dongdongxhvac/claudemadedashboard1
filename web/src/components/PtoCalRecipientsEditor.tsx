// Manager-editable recipients for approved-PTO calendar invites (.ics).
//
// Per-site rule — notify-pto v12 (migration 0100):
//   UPark  — invites go to home-site managers (users.is_manager) + the
//            requesting engineer BY DEFAULT; this table (pto_cal_recipients,
//            migration 0096) holds EXTRAS added on top (client/director/admin).
//   Binney — invites go to EXACTLY this table's list (the O365 group, which
//            fans out to its members); managers + the engineer are reached
//            through the group, not individually. Empty list falls back to
//            the UPark rule.
// The copy below branches on siteCode so each panel states its own rule.
//
// Rendered by BOTH the UPark and Binney PTO panels with their site code.
// Additive shared component: self-contained queries/mutations, no shared
// hooks touched (isolate-new-features rule). RLS allows admin/manager writes.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

type Row = { id: string; email: string; note: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PtoCalRecipientsEditor({ siteCode }: { siteCode: 'upark' | 'binney' }) {
  const qc = useQueryClient();
  const LIST_KEY = ['pto_cal_recipients', siteCode];
  // Binney invites go ONLY to the list below (notify-pto v12); UPark adds
  // managers + the requesting engineer on top. Copy branches on this.
  const isBinney = siteCode === 'binney';

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
        .select('id, email, note')
        .eq('site_id', siteQ.data!)
        .order('email');
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 30_000,
  });

  // Default recipients summary: this site's managers (named — it's a short
  // list) and how many engineers are covered (each invite goes to the one
  // requesting engineer, so only the count is shown). UPark only — Binney
  // doesn't invite managers/engineers individually, so the query is skipped.
  const defaultsQ = useQuery({
    queryKey: ['pto_cal_defaults', siteCode, siteQ.data ?? null],
    enabled: !!siteQ.data && !isBinney,
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
    mutationFn: async (input: { email: string; note: string | null }) => {
      const { error } = await supabase.from('pto_cal_recipients').insert({
        site_id: siteQ.data!,
        email: input.email.trim().toLowerCase(),
        note: input.note?.trim() || null,
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
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const rows = listQ.data ?? [];
  const validEmail = EMAIL_RE.test(email.trim());
  const dup = rows.some((r) => r.email.toLowerCase() === email.trim().toLowerCase());

  const onAdd = () => {
    if (!validEmail || dup || !siteQ.data) return;
    add.mutate({ email, note }, { onSuccess: () => { setEmail(''); setNote(''); } });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="t-small t-muted uppercase tracking-wider hover:t-accent"
        title={isBinney
          ? 'Invites go only to the recipients listed below (the group fans out to its members)'
          : 'Invites go to home-site managers + the requesting engineer by default; extras (client / director / admin) are added below'}
      >
        {open ? '▾' : '▸'} Calendar invites · {isBinney
          ? `${rows.length} recipient${rows.length === 1 ? '' : 's'}`
          : `${defaultsQ.data?.managers.length ?? '…'} managers · ${defaultsQ.data?.engineerCount ?? '…'} engineers · ${rows.length} extras`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="t-small t-muted">
            {isBinney ? (
              <>
                Invites go <strong>only to the recipients listed below</strong>. The group
                fans out to its members, so managers and the requesting engineer are reached
                through the group — not invited individually.
                {rows.length === 0 && (
                  <span className="t-danger"> List is empty — invites currently fall back to
                    managers + the requesting engineer. Add the group to restore group-only
                    delivery.</span>
                )}
              </>
            ) : (
              <>
                <strong>Managers ({defaultsQ.data?.managers.length ?? 0})</strong>:{' '}
                {defaultsQ.data?.managers.join(', ') || '—'}
                {' · '}
                <strong>Engineers ({defaultsQ.data?.engineerCount ?? 0})</strong>: each invite
                goes to the engineer whose PTO it is
                {' · '}
                <strong>Extras ({rows.length})</strong>: added below — any inbox, gets every
                invite and cancellation.
              </>
            )}
            {siteQ.data === null && !siteQ.isLoading && (
              <span className="t-danger"> Site row missing — cannot edit.</span>
            )}
          </p>
          <ul className="flex flex-wrap gap-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="t-small"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0.15rem 0.5rem', borderRadius: 999,
                  border: '1px solid var(--color-border)', background: 'var(--color-card)',
                }}
              >
                <span>{r.email}</span>
                {r.note && <span className="t-muted">· {r.note}</span>}
                <button
                  type="button"
                  onClick={() => remove.mutate(r.id)}
                  disabled={remove.isPending}
                  className="t-muted hover:t-danger"
                  title="Remove recipient"
                  style={{ fontSize: 14, lineHeight: 1 }}
                >×</button>
              </li>
            ))}
          </ul>
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
              onClick={onAdd}
              disabled={!validEmail || dup || add.isPending || !siteQ.data}
              title={dup ? 'Already in the list' : !validEmail ? 'Enter a valid email' : undefined}
              className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-accent)' }}
            >
              {add.isPending ? 'Adding…' : '+ Add'}
            </button>
            {add.error && (
              <span className="t-small t-danger">{(add.error as Error).message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
