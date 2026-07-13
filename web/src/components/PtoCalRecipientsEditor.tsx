// Manager-editable EXTRA recipients for approved-PTO calendar invites (.ics).
//
// Invites go to the home-site managers (users.is_manager) + the requesting
// engineer BY DEFAULT — that built-in list is not shown or editable here.
// This pool (pto_cal_recipients, migration 0096) holds the extras a manager
// adds on top: client, director, admin — anything with an inbox. notify-pto
// merges default + extras (deduped) when it sends METHOD:REQUEST / CANCEL.
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
        title="Invites go to home-site managers + the engineer by default; this list adds extra recipients (client / director / admin)"
      >
        {open ? '▾' : '▸'} Calendar invite extras ({rows.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="t-small t-muted">
            Default: home-site managers + the engineer. Anyone added here (client,
            director, admin — any inbox) also gets every invite and cancellation.
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
