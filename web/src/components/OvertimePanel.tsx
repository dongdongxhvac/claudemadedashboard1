// §11 — Overtime coverage (Phase 11).
//
// Four-column category grid (Cold WX · Major PM · Repair · Vendor escort).
// Each card shows a post + signup chips. Engineers self-serve via [Sign me up];
// admin/manager/lead get [+ Assign…] and [Cancel post] controls.
//
// Layout philosophy: a digital whiteboard. Reads top-to-bottom in chrono order
// within each category column. Filled = grey card · open = brighter card with
// the [+] CTA · cancelled = strikethrough.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useOvertimePosts,
  useOvertimeRealtime,
  useCreateOvertimePost,
  useCancelOvertimePost,
  useRestoreOvertimePost,
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

const RECENTLY_CANCELLED_WINDOW_DAYS = 3;
const PAST_GRACE_HOURS = 24;
/** How long a post stays "NEW" — pinned to the top of its category column
 *  with a NEW badge so engineers can't miss a freshly-posted shift. */
const NEW_POST_WINDOW_HOURS = 24;

function isNewPost(p: OvertimePost): boolean {
  const ageMs = Date.now() - new Date(p.created_at).getTime();
  return ageMs <= NEW_POST_WINDOW_HOURS * 3600 * 1000;
}

export function OvertimePanel() {
  useOvertimeRealtime();
  const postsQ     = useOvertimePosts();
  const meQ        = useMe();
  const buildingsQ = useBuildings();
  const engineersQ = useEngineers();
  const cancelPost  = useCancelOvertimePost();
  const restorePost = useRestoreOvertimePost();

  const [showNew, setShowNew] = useState(false);
  const [showAssignFor, setShowAssignFor] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  // Last-cancelled toast — surfaces an [Undo] for ~10s right after a Cancel,
  // independent of the longer 3-day Recently Cancelled drawer.
  const [toastPostId, setToastPostId] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const me            = meQ.data ?? null;
  const canManage     = me?.role === 'admin' || me?.role === 'manager' || me?.is_manager || me?.is_lead;
  const myUserId      = me?.id ?? null;

  // Partition posts client-side:
  //   active            — open/closed AND within their time window
  //   recentlyCancelled — cancelled in the last 3 days (drawer w/ Restore)
  //   archive           — everything older or otherwise historical
  const partitioned = useMemo(() => {
    const active: Record<OvertimeCategory, OvertimePost[]> = {
      cold_weather: [], major_off_hour_pm: [], off_hour_repair: [], vendor_escort: [],
    };
    const recentlyCancelled: OvertimePost[] = [];
    const archive: OvertimePost[] = [];
    const now      = Date.now();
    const graceMs  = PAST_GRACE_HOURS * 3600 * 1000;
    const undoMs   = RECENTLY_CANCELLED_WINDOW_DAYS * 24 * 3600 * 1000;

    for (const p of postsQ.data ?? []) {
      const endAt  = new Date(p.ends_at ?? p.starts_at).getTime();
      const isPast = endAt < now - graceMs;

      if (p.status === 'cancelled') {
        const cancelledMs = p.cancelled_at ? now - new Date(p.cancelled_at).getTime() : Infinity;
        if (cancelledMs <= undoMs) recentlyCancelled.push(p);
        else                       archive.push(p);
        continue;
      }
      if (p.status === 'completed' || isPast) {
        archive.push(p);
        continue;
      }
      active[p.category].push(p);
    }

    // Within each category: NEW posts (created in last 24h) lead, then
    // everyone else sorted by starts_at ascending. Engineers see fresh
    // listings at the top regardless of when the shift actually is.
    for (const cat of Object.keys(active) as OvertimeCategory[]) {
      active[cat].sort((a, b) => {
        const an = isNewPost(a) ? 1 : 0;
        const bn = isNewPost(b) ? 1 : 0;
        if (an !== bn) return bn - an;   // new first
        return a.starts_at.localeCompare(b.starts_at);
      });
    }

    recentlyCancelled.sort((a, b) =>
      (b.cancelled_at ?? '').localeCompare(a.cancelled_at ?? ''));
    // Archive newest-first so recent history sits at the top of the drawer.
    archive.sort((a, b) => b.starts_at.localeCompare(a.starts_at));

    return { active, recentlyCancelled, archive };
  }, [postsQ.data]);

  const totals = useMemo(() => {
    const open = (postsQ.data ?? []).filter((p) => p.status === 'open');
    const slotsNeeded = open.reduce((s, p) => s + p.slots_needed, 0);
    const slotsFilled = open.reduce((s, p) => s + p.slots_filled, 0);
    return { openCount: open.length, slotsNeeded, slotsFilled };
  }, [postsQ.data]);

  const handleCancel = (postId: string) => {
    cancelPost.mutate(postId);
    setToastPostId(postId);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastPostId(null), 10_000);
  };
  const handleUndo = () => {
    if (toastPostId) restorePost.mutate(toastPostId);
    setToastPostId(null);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  };
  // Clean up the timer if the panel unmounts.
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

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
    <Section collapsible title="§11 Upcoming overtime" subtitle={subtitle} loading={postsQ.isLoading}>
      {postsQ.error ? (
        <p className="t-text t-danger">Error: {(postsQ.error as Error).message}</p>
      ) : (
        <>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
          >
            {OVERTIME_CATEGORY_ORDER.map((cat) => (
              <CategoryColumn
                key={cat}
                category={cat}
                posts={partitioned.active[cat]}
                myUserId={myUserId}
                canManage={!!canManage}
                onAssign={(postId) => setShowAssignFor(postId)}
                onCancel={handleCancel}
              />
            ))}
          </div>

          {/* Recently cancelled — last 3 days, with Restore. The DB trigger
              clears cancelled_at on restore so posts vanish from this
              drawer the moment they're brought back. */}
          {partitioned.recentlyCancelled.length > 0 && (
            <CollapsibleDrawer
              open={showRecent}
              onToggle={() => setShowRecent((v) => !v)}
              label={`Recently cancelled · last ${RECENTLY_CANCELLED_WINDOW_DAYS} days`}
              count={partitioned.recentlyCancelled.length}
            >
              <ul className="space-y-1.5 mt-2">
                {partitioned.recentlyCancelled.map((p) => (
                  <HistoryRow
                    key={p.id}
                    post={p}
                    showRestore={!!canManage}
                    onRestore={() => restorePost.mutate(p.id)}
                  />
                ))}
              </ul>
            </CollapsibleDrawer>
          )}

          {/* Archive — past + long-ago-cancelled. Read-only audit view. */}
          {partitioned.archive.length > 0 && (
            <CollapsibleDrawer
              open={showArchive}
              onToggle={() => setShowArchive((v) => !v)}
              label="Archive · past 90 days"
              count={partitioned.archive.length}
            >
              <ul className="space-y-1.5 mt-2">
                {partitioned.archive.map((p) => (
                  <HistoryRow key={p.id} post={p} showRestore={false} />
                ))}
              </ul>
            </CollapsibleDrawer>
          )}
        </>
      )}

      {/* Undo toast — slides in for 10s after a Cancel. Independent of the
          longer 3-day Recently Cancelled drawer; this is just the quick
          "oh wait, I didn't mean to" affordance right after the click. */}
      {toastPostId && (
        <div
          role="status"
          style={{
            position: 'fixed', right: 24, bottom: 24,
            background: 'var(--color-text)', color: 'var(--color-card)',
            padding: '0.6rem 1rem', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: 50, display: 'flex', alignItems: 'center', gap: 12,
          }}
          className="t-small"
        >
          <span>Overtime post cancelled.</span>
          <button onClick={handleUndo} className="hover:underline" style={{ color: '#7dd3fc', fontWeight: 600 }}>
            Undo
          </button>
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
  category, posts, myUserId, canManage, onAssign, onCancel,
}: {
  category: OvertimeCategory;
  posts: OvertimePost[];
  myUserId: string | null;
  canManage: boolean;
  onAssign: (postId: string) => void;
  onCancel: (postId: string) => void;
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
              onCancel={() => onCancel(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Collapsible drawer used for the Recently Cancelled and Archive sections. */
function CollapsibleDrawer({
  open, onToggle, label, count, children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="t-small t-muted hover:underline"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        <span className="uppercase tracking-wider">{label}</span>
        <span className="t-muted">({count})</span>
      </button>
      {open && children}
    </div>
  );
}

/** Compact one-line row used inside the Recently Cancelled and Archive
 *  drawers. Strikethrough for cancelled; status badge for everything else. */
function HistoryRow({
  post, showRestore, onRestore,
}: {
  post: OvertimePost;
  showRestore: boolean;
  onRestore?: () => void;
}) {
  const cancelled = post.status === 'cancelled';
  const accent    = CATEGORY_ACCENT[post.category];
  const filled    = post.slots_filled;
  const needed    = post.slots_needed;
  const stamp     = cancelled && post.cancelled_at
    ? `cancelled ${fmtRelative(post.cancelled_at)}`
    : null;
  return (
    <li
      className="t-small flex items-baseline gap-2 flex-wrap"
      style={{
        padding: '0.35rem 0.6rem',
        borderLeft: `3px solid ${accent}`,
        background: 'var(--color-card)',
        borderRadius: 4,
        opacity: cancelled ? 0.6 : 0.9,
      }}
    >
      <span className="t-muted" style={{ minWidth: 160 }}>
        {fmtWhen(post.starts_at, post.ends_at)}
      </span>
      <span style={{ textDecoration: cancelled ? 'line-through' : undefined, fontWeight: 500 }}>
        {buildingLabel(post) && <span className="t-mono">Bld {buildingLabel(post)} · </span>}
        {post.scope}
      </span>
      <span
        className="t-small uppercase tracking-wider"
        style={{
          fontSize: 9, fontWeight: 600,
          padding: '0.05rem 0.4rem', borderRadius: 3,
          background: cancelled ? 'rgba(239,68,68,0.12)' : 'rgba(100,116,139,0.12)',
          color: cancelled ? '#b91c1c' : '#475569',
        }}
      >
        {cancelled ? 'Cancelled' : post.status === 'completed' ? 'Completed' : 'Past'}
      </span>
      {stamp && <span className="t-muted" style={{ fontSize: 10 }}>{stamp}</span>}
      <span className="t-muted t-mono ml-auto" style={{ fontSize: 11 }}>
        {filled}/{needed}{post.signups.length > 0 && (
          <span className="ml-1">· {post.signups.map((s) => shortName(s.user_name)).join(', ')}</span>
        )}
      </span>
      {showRestore && onRestore && (
        <button
          onClick={onRestore}
          className="t-accent hover:underline"
          style={{ fontSize: 11, fontWeight: 600 }}
        >
          Restore
        </button>
      )}
    </li>
  );
}

/** "2026-05-27T18:23:00Z" → "5h ago" / "2d ago" / "just now". */
function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function PostCard({
  post, accent, myUserId, canManage, onAssign, onCancel,
}: {
  post: OvertimePost;
  accent: string;
  myUserId: string | null;
  canManage: boolean;
  onAssign: () => void;
  onCancel: () => void;
}) {
  const signUp     = useSignUpForOvertime();
  const unSignUp   = useUnSignUpForOvertime();
  const adminRm    = useAdminRemoveSignup();

  const cancelled = post.status === 'cancelled';
  const closed    = post.status === 'closed';
  const isFull    = post.slots_filled >= post.slots_needed;
  const mySignup  = myUserId ? post.signups.find((s) => s.user_id === myUserId) ?? null : null;
  const iAmIn     = !!mySignup;
  const isNew     = isNewPost(post) && !cancelled;

  return (
    <div
      className="t-card"
      style={{
        borderLeft: `3px solid ${accent}`,
        opacity: cancelled ? 0.45 : 1,
        textDecoration: cancelled ? 'line-through' : undefined,
        padding: '0.6rem 0.8rem',
        // Faint accent fill + thicker shadow on NEW posts so they catch the eye.
        background: isNew ? `${accent}11` : undefined,
        boxShadow: isNew ? `0 0 0 1px ${accent}66` : undefined,
      }}
    >
      <div className="t-small t-muted flex items-center gap-2">
        {isNew && (
          <span
            className="uppercase tracking-wider"
            style={{
              fontSize: 9, fontWeight: 700, padding: '0.1rem 0.4rem',
              borderRadius: 3, background: accent, color: '#fff',
              letterSpacing: '0.08em',
            }}
            title={`Posted ${fmtRelative(post.created_at)}`}
          >
            NEW
          </span>
        )}
        <span>{fmtWhen(post.starts_at, post.ends_at)}</span>
      </div>
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
            onClick={onCancel}
            className="t-small t-muted hover:t-danger ml-auto"
            style={{ fontSize: '0.7rem' }}
            title="Cancel this post (undo for 10s via toast, or anytime in the next 3 days via Recently Cancelled drawer)"
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
