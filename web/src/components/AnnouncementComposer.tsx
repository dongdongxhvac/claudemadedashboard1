import { useState } from 'react';
import { usePostAnnouncement, type FocusLevel } from '../hooks/useFocusBoard';

const LEVELS: { value: FocusLevel; label: string }[] = [
  { value: 'info',     label: 'Info' },
  { value: 'warn',     label: 'Warn' },
  { value: 'urgent',   label: 'Urgent' },
  { value: 'critical', label: 'Critical' },
];

const EXPIRY_PRESETS: { label: string; hours: number | null }[] = [
  { label: '1 hour',  hours: 1 },
  { label: '8 hours', hours: 8 },
  { label: '24 hours', hours: 24 },
  { label: '7 days',  hours: 24 * 7 },
  { label: 'No expiry', hours: null },
];

function plusHoursIso(h: number | null): string | null {
  if (h === null) return null;
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

export function AnnouncementComposer() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<FocusLevel>('info');
  const [expiryHours, setExpiryHours] = useState<number | null>(24);
  const [pinned, setPinned] = useState(false);
  const post = usePostAnnouncement();

  const reset = () => {
    setBody('');
    setLevel('info');
    setExpiryHours(24);
    setPinned(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await post.mutateAsync({
      body,
      level,
      pinned,
      expires_at: plusHoursIso(expiryHours),
    });
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => setOpen(true)}
          className="t-small px-3 py-1 rounded border"
          style={{
            color: 'var(--color-accent)',
            borderColor: 'var(--color-accent)',
            background: 'var(--color-card)',
          }}
        >
          + Post announcement
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="t-card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="t-section-title">Post announcement</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          className="t-small t-muted hover:underline"
        >
          Cancel
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={3}
        autoFocus
        placeholder="What does the team need to know?"
        className="w-full border rounded px-3 py-2 t-text"
        style={{ borderColor: 'var(--color-border)' }}
      />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 t-small">
          Level
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as FocusLevel)}
            className="border rounded px-2 py-1 t-small"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 t-small">
          Expires in
          <select
            value={expiryHours === null ? 'null' : String(expiryHours)}
            onChange={(e) => setExpiryHours(e.target.value === 'null' ? null : Number(e.target.value))}
            className="border rounded px-2 py-1 t-small"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            {EXPIRY_PRESETS.map((p) => (
              <option key={p.label} value={p.hours === null ? 'null' : String(p.hours)}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 t-small">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to top
        </label>

        <div className="ml-auto flex items-center gap-2">
          {post.isError && (
            <span className="t-small t-danger">{(post.error as Error).message}</span>
          )}
          <button
            type="submit"
            disabled={post.isPending || !body.trim()}
            className="t-small px-3 py-1 rounded font-medium disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            {post.isPending ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </form>
  );
}
