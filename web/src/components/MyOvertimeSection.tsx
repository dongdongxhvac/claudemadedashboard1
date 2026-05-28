// §11 (Phase 11b) — engineer self-serve OT coverage.
//
// Compact list of currently-open overtime posts the signed-in engineer can
// sign up for. Locked to their user_id (passed in by the engineer route).
// Posts created within 24h get the same NEW badge + visual emphasis as the
// manager view, and they sort to the top regardless of starts_at.
//
// RLS:
//   overtime_posts_auth_select       — everyone authed can read
//   overtime_signups_self_or_admin_*  — engineer can INSERT/DELETE their
//                                       own signups; admin/manager/lead
//                                       can act on anyone's

import { useMemo } from 'react';
import {
  useOvertimePosts,
  useOvertimeRealtime,
  useSignUpForOvertime,
  useUnSignUpForOvertime,
  OVERTIME_CATEGORY_LABELS,
  type OvertimePost,
} from '../hooks/useOvertime';

const CATEGORY_ACCENT: Record<string, string> = {
  cold_weather:      '#60a5fa',
  major_off_hour_pm: '#a78bfa',
  off_hour_repair:   '#fb923c',
  vendor_escort:     '#f472b6',
};

const NEW_POST_WINDOW_HOURS = 24;
const PAST_GRACE_HOURS      = 24;

function isNewPost(p: OvertimePost): boolean {
  return Date.now() - new Date(p.created_at).getTime() <= NEW_POST_WINDOW_HOURS * 3600 * 1000;
}

function fmtWhen(starts: string, ends: string | null): string {
  const s = new Date(starts);
  const e = ends ? new Date(ends) : null;
  const dateStr = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  const timeStr = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!e) return `${dateStr(s)} ${timeStr(s)}`;
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${dateStr(s)} ${timeStr(s)} – ${timeStr(e)}`
    : `${dateStr(s)} ${timeStr(s)} – ${dateStr(e)} ${timeStr(e)}`;
}

function buildingLabel(p: OvertimePost): string {
  return p.building_short_code || p.building_code || p.building_label || '';
}

export function MyOvertimeSection({ userId, compact = false }: { userId: string; compact?: boolean }) {
  useOvertimeRealtime();
  const postsQ   = useOvertimePosts();
  const signUp   = useSignUpForOvertime();
  const unSignUp = useUnSignUpForOvertime();

  const visible = useMemo(() => {
    const now = Date.now();
    const graceMs = PAST_GRACE_HOURS * 3600 * 1000;
    return (postsQ.data ?? [])
      .filter((p) => {
        if (p.status === 'cancelled' || p.status === 'completed') return false;
        const endAt = new Date(p.ends_at ?? p.starts_at).getTime();
        return endAt >= now - graceMs;
      })
      .sort((a, b) => {
        const an = isNewPost(a) ? 1 : 0;
        const bn = isNewPost(b) ? 1 : 0;
        if (an !== bn) return bn - an;
        return a.starts_at.localeCompare(b.starts_at);
      });
  }, [postsQ.data]);

  const newCount = visible.filter(isNewPost).length;

  return (
    <section className={compact ? '' : 't-card'} style={compact ? undefined : { padding: 0 }}>
      <div className={compact ? 'px-3 py-2' : 'px-4 py-3'} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="t-section-title">Overtime coverage</h2>
          <span className="t-small t-muted">
            {visible.length} open
            {newCount > 0 && (
              <span style={{ marginLeft: 6, color: 'var(--color-accent)', fontWeight: 600 }}>
                · {newCount} new
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        {postsQ.isLoading ? (
          <p className="t-small t-muted italic">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="t-small t-muted italic">No open overtime right now.</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                userId={userId}
                onSignUp={() => signUp.mutate(p.id)}
                onUnSignUp={() => { if (confirm('Remove yourself from this OT?')) unSignUp.mutate(p.id); }}
                pending={signUp.isPending || unSignUp.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PostRow({
  post, userId, onSignUp, onUnSignUp, pending,
}: {
  post: OvertimePost;
  userId: string;
  onSignUp: () => void;
  onUnSignUp: () => void;
  pending: boolean;
}) {
  const accent  = CATEGORY_ACCENT[post.category] ?? 'var(--color-accent)';
  const isNew   = isNewPost(post);
  const mine    = post.signups.find((s) => s.user_id === userId);
  const isFull  = post.slots_filled >= post.slots_needed;
  const closed  = post.status === 'closed';
  const cat     = OVERTIME_CATEGORY_LABELS[post.category];

  return (
    <li
      style={{
        borderLeft: `3px solid ${accent}`,
        padding: '0.5rem 0.7rem',
        borderRadius: 4,
        background: isNew ? `${accent}11` : 'var(--color-card)',
        boxShadow: isNew ? `0 0 0 1px ${accent}66` : undefined,
        border: isNew ? undefined : '1px solid var(--color-border-soft)',
        borderLeftWidth: 3,
      }}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        {isNew && (
          <span
            className="uppercase tracking-wider"
            style={{
              fontSize: 9, fontWeight: 700, padding: '0.1rem 0.4rem',
              borderRadius: 3, background: accent, color: '#fff',
              letterSpacing: '0.08em',
            }}
          >NEW</span>
        )}
        <span className="t-small t-muted">{fmtWhen(post.starts_at, post.ends_at)}</span>
        <span
          className="t-small uppercase tracking-wider"
          style={{ fontSize: 9, fontWeight: 600, color: accent, marginLeft: 'auto' }}
        >
          {cat}
        </span>
      </div>
      <div className="t-text font-medium" style={{ marginTop: 2 }}>
        {buildingLabel(post) && (
          <span className="t-mono" style={{ color: 'var(--color-text)' }}>
            Bld {buildingLabel(post)} ·{' '}
          </span>
        )}
        {post.scope}
      </div>
      {post.notes && (
        <div className="t-small t-muted" style={{ marginTop: 2 }}>{post.notes}</div>
      )}

      {/* Filled chips */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {post.signups.map((s) => (
          <span
            key={s.id}
            className="t-small"
            style={{
              padding: '0.1rem 0.45rem',
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              background: s.user_id === userId ? 'rgba(16,185,129,0.12)' : 'var(--color-card)',
              color: s.user_id === userId ? '#047857' : 'var(--color-text)',
              fontWeight: s.user_id === userId ? 600 : 400,
            }}
          >
            ✓ {s.user_name ?? '?'}{s.user_id === userId && ' (you)'}
          </span>
        ))}
        {Array.from({ length: Math.max(0, post.slots_needed - post.slots_filled) }).map((_, i) => (
          <span
            key={`open-${i}`}
            className="t-small t-muted"
            style={{
              padding: '0.1rem 0.45rem',
              border: '1px dashed var(--color-border)',
              borderRadius: 999,
            }}
          >▢ open</span>
        ))}
      </div>

      {/* Action */}
      <div className="flex items-center gap-2 mt-2">
        {mine ? (
          <button
            onClick={onUnSignUp}
            disabled={pending}
            className="t-small px-2 py-1 rounded border"
            style={{
              background: 'var(--color-card)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            {pending ? 'Working…' : 'Withdraw'}
          </button>
        ) : isFull || closed ? (
          <span className="t-small t-muted italic">
            {closed ? 'Closed.' : 'All slots filled.'}
          </span>
        ) : (
          <button
            onClick={onSignUp}
            disabled={pending}
            className="t-small px-3 py-1 rounded text-white"
            style={{ background: accent, fontWeight: 600 }}
          >
            {pending ? 'Signing up…' : 'Sign me up'}
          </button>
        )}
        <span className="t-small t-muted ml-auto t-mono" style={{ fontSize: 11 }}>
          {post.slots_filled}/{post.slots_needed}
        </span>
      </div>
    </li>
  );
}
