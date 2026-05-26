// §11 — Overtime coverage (Phase 11).
//
// Four-column category grid (Cold WX · Major PM · Repair · Vendor escort).
// Each card shows a post + signup chips. Engineers self-serve via [Sign me up];
// admin/manager/lead get [+ Assign…] and [Cancel post] controls.
//
// Layout philosophy: a digital whiteboard. Reads top-to-bottom in chrono order
// within each category column. Filled = grey card · open = brighter card with
// the [+] CTA · cancelled = strikethrough.
import { useMemo, useState } from 'react';
import {
  useOvertimePosts,
  useOvertimeRealtime,
  useCreateOvertimePost,
  useCancelOvertimePost,
  useSignUpForOvertime,
  useUnSignUpForOvertime,
  useAdminAssignToOvertime,
  useAdminRemoveSignup,
  OVERTIME_CATEGORY_LABELS,
  OVERTIME_CATEGORY_ORDER,
  type OvertimeCategory,
  type OvertimePost,
} from '../hooks/useOvertime';
import { useBuildings } from '../hooks/useBuildings';
import { useEngineers } from '../hooks/useEngineers';
import { useMe } from '../hooks/useMe';
import { Section } from './Section';

const CATEGORY_ACCENT: Record<OvertimeCategory, string> = {
  cold_weather:      '#60a5fa',  // blue — winter
  major_off_hour_pm: '#a78bfa',  // purple — PM theme matches OpenPMsBreakdown
  off_hour_repair:   '#fb923c',  // orange — repair / wrench
  vendor_escort:     '#f472b6',  // pink — vendor/escort
};

function fmtWhen(starts: string, ends: string | null): string {
  const s = new Date(starts);
  const e = ends ? new Date(ends) : null;
  const sameDay = e
    ? s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate()
    : true;
  const dateStr = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  const timeStr = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!e) return `${dateStr(s)} ${timeStr(s)}`;
  if (sameDay) return `${dateStr(s)} ${timeStr(s)} — ${timeStr(e)}`;
  return `${dateStr(s)} ${timeStr(s)} — ${dateStr(e)} ${timeStr(e)}`;
}

function buildingLabel(p: OvertimePost): string {
  if (p.building_short_code || p.building_code) return p.building_short_code ?? p.building_code ?? '';
  return p.building_label ?? '';
}

function shortName(full: string | null | undefined): string {
  if (!full) return '—';
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function OvertimePanel() {
  useOvertimeRealtime();
  const postsQ     = useOvertimePosts();
  const meQ        = useMe();
  const buildingsQ = useBuildings();
  const engineersQ = useEngineers();

  const [showNew, setShowNew] = useState(false);
  const [showAssignFor, setShowAssignFor] = useState<string | null>(null);

  const me            = meQ.data ?? null;
  const canManage     = me?.role === 'admin' || me?.role === 'manager' || me?.is_manager || me?.is_lead;
  const myUserId      = me?.id ?? null;

  const byCategory = useMemo(() => {
    const map: Record<OvertimeCategory, OvertimePost[]> = {
      cold_weather: [], major_off_hour_pm: [], off_hour_repair: [], vendor_escort: [],
    };
    for (const p of postsQ.data ?? []) {
      // Hide completed posts that ended >24h ago — keep the column tight.
      if (p.status === 'completed') continue;
      map[p.category].push(p);
    }
    return map;
  }, [postsQ.data]);

  const totals = useMemo(() => {
    const posts = postsQ.data ?? [];
    const open = posts.filter((p) => p.status === 'open');
    const slotsNeeded = open.reduce((s, p) => s + p.slots_needed, 0);
    const slotsFilled = open.reduce((s, p) => s + p.slots_filled, 0);
    return { openCount: open.length, slotsNeeded, slotsFilled };
  }, [postsQ.data]);

  const subtitle = (
    <span className="t-small t-muted">
      <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{totals.openCount} open</span>
      {' · '}
      <span style={{ color: totals.slotsFilled < totals.slotsNeeded ? 'var(--color-warning, #d97706)' : 'var(--color-text)' }}>
        {totals.slotsFilled}/{totals.slotsNeeded} slots filled
      </span>
      {canManage && (
        <button
          onClick={() => setShowNew(true)}
          className="ml-3 t-accent hover:underline"
          style={{ fontWeight: 600 }}
        >
          + New post
        </button>
      )}
    </span>
  );

  return (
    <Section title="§11 Upcoming overtime" subtitle={subtitle} loading={postsQ.isLoading}>
      {postsQ.error ? (
        <p className="t-text t-danger">Error: {(postsQ.error as Error).message}</p>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
        >
          {OVERTIME_CATEGORY_ORDER.map((cat) => (
            <CategoryColumn
              key={cat}
              category={cat}
              posts={byCategory[cat]}
              myUserId={myUserId}
              canManage={!!canManage}
              onAssign={(postId) => setShowAssignFor(postId)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewPostModal
          onClose={() => setShowNew(false)}
          buildings={buildingsQ.data ?? []}
        />
      )}

      {showAssignFor && (
        <AssignEngineerModal
          postId={showAssignFor}
          posts={postsQ.data ?? []}
          engineers={engineersQ.data ?? []}
          onClose={() => setShowAssignFor(null)}
        />
      )}
    </Section>
  );
}

function CategoryColumn({
  category, posts, myUserId, canManage, onAssign,
}: {
  category: OvertimeCategory;
  posts: OvertimePost[];
  myUserId: string | null;
  canManage: boolean;
  onAssign: (postId: string) => void;
}) {
  const accent = CATEGORY_ACCENT[category];
  const label  = OVERTIME_CATEGORY_LABELS[category];
  return (
    <div>
      <div
        className="t-small font-semibold uppercase tracking-wider mb-2 pb-1"
        style={{ color: accent, borderBottom: `2px solid ${accent}` }}
      >
        {label} <span className="t-muted ml-1">({posts.length})</span>
      </div>
      {posts.length === 0 ? (
        <p className="t-text t-muted text-sm italic">No posts.</p>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              accent={accent}
              myUserId={myUserId}
              canManage={canManage}
              onAssign={() => onAssign(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post, accent, myUserId, canManage, onAssign,
}: {
  post: OvertimePost;
  accent: string;
  myUserId: string | null;
  canManage: boolean;
  onAssign: () => void;
}) {
  const signUp     = useSignUpForOvertime();
  const unSignUp   = useUnSignUpForOvertime();
  const adminRm    = useAdminRemoveSignup();
  const cancelPost = useCancelOvertimePost();

  const cancelled = post.status === 'cancelled';
  const closed    = post.status === 'closed';
  const isFull    = post.slots_filled >= post.slots_needed;
  const mySignup  = myUserId ? post.signups.find((s) => s.user_id === myUserId) ?? null : null;
  const iAmIn     = !!mySignup;

  return (
    <div
      className="t-card"
      style={{
        borderLeft: `3px solid ${accent}`,
        opacity: cancelled ? 0.45 : 1,
        textDecoration: cancelled ? 'line-through' : undefined,
        padding: '0.6rem 0.8rem',
      }}
    >
      <div className="t-small t-muted">{fmtWhen(post.starts_at, post.ends_at)}</div>
      <div className="t-text font-semibold" style={{ marginTop: '0.15rem' }}>
        {buildingLabel(post) && (
          <span className="t-mono" style={{ color: 'var(--color-text)' }}>
            Bld {buildingLabel(post)}{' · '}
          </span>
        )}
        {post.scope}
      </div>
      {post.notes && (
        <div className="t-small t-muted" style={{ marginTop: '0.15rem' }}>{post.notes}</div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {post.signups.map((s) => (
          <span
            key={s.id}
            className="t-small inline-flex items-center gap-1"
            style={{
              padding: '0.1rem 0.45rem',
              border: '1px solid var(--color-border)',
              borderRadius: '999px',
              background: 'var(--color-card)',
            }}
            title={s.self_signup ? 'Self-signed up' : 'Assigned by manager'}
          >
            <span style={{ color: 'var(--color-ok, #10b981)' }}>✓</span>
            <span>{shortName(s.user_name)}</span>
            {!s.self_signup && (
              <span className="t-muted" style={{ fontSize: '0.65rem' }}>(assigned)</span>
            )}
            {(s.user_id === myUserId || canManage) && (
              <button
                onClick={() => {
                  if (s.user_id === myUserId) unSignUp.mutate(post.id);
                  else                        adminRm.mutate(s.id);
                }}
                className="t-muted hover:t-danger"
                title={s.user_id === myUserId ? 'Remove me' : 'Remove this engineer'}
                style={{ marginLeft: '0.15rem', fontSize: '0.7rem' }}
              >×</button>
            )}
          </span>
        ))}
        {Array.from({ length: Math.max(0, post.slots_needed - post.slots_filled) }).map((_, i) => (
          <span
            key={`blank-${i}`}
            className="t-small t-muted inline-flex items-center"
            style={{
              padding: '0.1rem 0.45rem',
              border: '1px dashed var(--color-border)',
              borderRadius: '999px',
            }}
          >▢ open</span>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        {!cancelled && !closed && !iAmIn && !isFull && myUserId && (
          <button
            onClick={() => signUp.mutate(post.id)}
            disabled={signUp.isPending}
            className="t-small t-accent hover:underline"
            style={{ fontWeight: 600 }}
          >
            {signUp.isPending ? 'Signing up…' : 'Sign me up'}
          </button>
        )}
        {!cancelled && !closed && canManage && !isFull && (
          <button onClick={onAssign} className="t-small t-muted hover:underline">
            + Assign…
          </button>
        )}
        {!cancelled && canManage && (
          <button
            onClick={() => {
              if (confirm('Cancel this post?')) cancelPost.mutate(post.id);
            }}
            className="t-small t-muted hover:t-danger ml-auto"
            style={{ fontSize: '0.7rem' }}
          >Cancel</button>
        )}
        {cancelled && (
          <span className="t-small t-muted" style={{ fontStyle: 'italic' }}>Cancelled</span>
        )}
        <span className="t-small t-muted ml-auto" style={{ fontSize: '0.7rem' }}>
          {post.slots_filled}/{post.slots_needed}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// New-post modal
// ============================================================================

function NewPostModal({
  onClose, buildings,
}: {
  onClose: () => void;
  buildings: { id: string; code: string; short_code: string | null; name: string }[];
}) {
  const create = useCreateOvertimePost();
  const [category, setCategory]       = useState<OvertimeCategory>('major_off_hour_pm');
  const [startsLocal, setStartsLocal] = useState('');
  const [endsLocal, setEndsLocal]     = useState('');
  const [buildingId, setBuildingId]   = useState<string>('');
  const [buildingLabel, setBuildingLabel] = useState<string>('');
  const [scope, setScope]             = useState('');
  const [slotsNeeded, setSlotsNeeded] = useState(1);
  const [notes, setNotes]             = useState('');
  const [err, setErr]                 = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!scope.trim()) { setErr('Scope is required.'); return; }
    if (!startsLocal)  { setErr('Start time is required.'); return; }
    try {
      await create.mutateAsync({
        category,
        starts_at:      new Date(startsLocal).toISOString(),
        ends_at:        endsLocal ? new Date(endsLocal).toISOString() : null,
        building_id:    buildingId || null,
        building_label: buildingId ? null : (buildingLabel.trim() || null),
        scope,
        slots_needed:   slotsNeeded,
        notes:          notes.trim() || null,
      });
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  };

  return (
    <ModalShell onClose={onClose} title="New overtime post">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="t-small t-muted mb-1">Category</div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as OvertimeCategory)}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            {OVERTIME_CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{OVERTIME_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="t-small t-muted mb-1">Slots needed</div>
          <input
            type="number" min={1} max={6}
            value={slotsNeeded}
            onChange={(e) => setSlotsNeeded(Math.max(1, Math.min(6, +e.target.value || 1)))}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <label className="block">
          <div className="t-small t-muted mb-1">Starts (local)</div>
          <input
            type="datetime-local"
            value={startsLocal}
            onChange={(e) => setStartsLocal(e.target.value)}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>
        <label className="block">
          <div className="t-small t-muted mb-1">Ends (optional)</div>
          <input
            type="datetime-local"
            value={endsLocal}
            onChange={(e) => setEndsLocal(e.target.value)}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <label className="block">
          <div className="t-small t-muted mb-1">Building</div>
          <select
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— pick or type below —</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.short_code ?? b.code} — {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="t-small t-muted mb-1">…or free-text (e.g. "730/750")</div>
          <input
            type="text"
            value={buildingLabel}
            onChange={(e) => setBuildingLabel(e.target.value)}
            disabled={!!buildingId}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            placeholder="730/750"
          />
        </label>

        <label className="block col-span-2">
          <div className="t-small t-muted mb-1">Scope of work</div>
          <input
            type="text"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            placeholder="e.g. Exh Annual PM"
          />
        </label>

        <label className="block col-span-2">
          <div className="t-small t-muted mb-1">Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full border rounded px-2 py-1 t-text" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>
      </div>

      {err && <p className="t-small t-danger mt-2">{err}</p>}

      <div className="flex gap-2 mt-4 justify-end">
        <button onClick={onClose} className="t-small">Cancel</button>
        <button
          onClick={submit}
          disabled={create.isPending}
          className="t-small t-accent font-semibold"
        >
          {create.isPending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </ModalShell>
  );
}

function AssignEngineerModal({
  postId, posts, engineers, onClose,
}: {
  postId: string;
  posts: OvertimePost[];
  engineers: { user_id: string; full_name: string; active: boolean; role: string }[];
  onClose: () => void;
}) {
  const assign = useAdminAssignToOvertime();
  const post   = posts.find((p) => p.id === postId);
  const taken  = new Set(post?.signups.map((s) => s.user_id) ?? []);
  const choices = engineers
    .filter((e) => e.active && e.role === 'engineer' && !taken.has(e.user_id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <ModalShell onClose={onClose} title="Assign engineer">
      {!post ? (
        <p className="t-text t-muted">Post not found.</p>
      ) : choices.length === 0 ? (
        <p className="t-text t-muted">All active engineers are already on this post.</p>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {choices.map((e) => (
            <li key={e.user_id}>
              <button
                onClick={async () => {
                  await assign.mutateAsync({ post_id: postId, user_id: e.user_id });
                  onClose();
                }}
                className="w-full text-left px-2 py-1 hover:bg-[var(--color-card-hover,#1f2937)] rounded"
              >
                {e.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end mt-3">
        <button onClick={onClose} className="t-small">Close</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  onClose, title, children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{ width: 'min(560px, 92vw)', maxHeight: '90vh', overflow: 'auto', padding: '1.25rem' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-section-title">{title}</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
