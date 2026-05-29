import type { ReactNode } from 'react';

export function Section({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="t-card">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="t-section-title">{title}</h2>
        {subtitle && <span className="t-small t-muted">{subtitle}</span>}
      </div>
      {loading ? <p className="t-text t-muted">Loading...</p> : children}
    </section>
  );
}
