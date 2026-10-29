// Cluster mark next to a Binney engineer's name — E (East · Ed Nardone) or
// W (West · Andrew Balbo), from engineer_profiles.cluster / manager_user_id
// (0154). The lookup every panel shares lives in hooks/useBinneyClusterIndex.
import { CLUSTER_LABEL, CLUSTER_STYLE, type Cluster } from '../../lib/binneyRounds';
import type { ClusterInfo } from './hooks/useBinneyClusterIndex';

export function ClusterBadge({
  cluster,
  manager,
  size = 14,
  className,
}: {
  cluster: Cluster | null | undefined;
  manager?: string | null;
  size?: number;
  className?: string;
}) {
  if (!cluster) return null;
  const s = CLUSTER_STYLE[cluster];
  return (
    <span
      className={className}
      title={`${CLUSTER_LABEL[cluster]} cluster${manager ? ` · manager ${manager}` : ''}`}
      aria-label={`${CLUSTER_LABEL[cluster]} cluster`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: 3, flex: '0 0 auto',
        fontSize: Math.round(size * 0.64), fontWeight: 800, lineHeight: 1,
        background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
        verticalAlign: 'middle',
      }}
    >
      {s.letter}
    </span>
  );
}

/** Name + badge in one span — for tables and chips. */
export function NameWithBadge({
  name,
  info,
  size = 12,
}: {
  name: string;
  info: ClusterInfo | null | undefined;
  size?: number;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span>{name}</span>
      <ClusterBadge cluster={info?.cluster} manager={info?.managerName} size={size} />
    </span>
  );
}
