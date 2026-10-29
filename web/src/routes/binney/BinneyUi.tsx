// Tiny shared bits for the Binney ops section (0154 panels).
import type { ReactNode } from 'react';

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
