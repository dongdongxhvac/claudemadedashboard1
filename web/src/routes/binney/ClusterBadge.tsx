// Cluster mark next to a Binney engineer's name — E / EF / EB (East · Ed
// Nardone: round engineer / floater / BMS) or W / WF / WB (West · Andrew
// Balbo), from engineer_profiles.cluster + cluster_role (0154/0155). The
// lookup every panel shares lives in hooks/useBinneyClusterIndex.
import { clusterBadgeLetters, clusterRoleLabel, type Cluster, type ClusterRole, CLUSTER_STYLE } from '../../lib/binneyRounds';
import type { ClusterInfo } from './hooks/useBinneyClusterIndex';

export function ClusterBadge({
  cluster,
  role,
  manager,
  size = 14,
  className,
}: {
  cluster: Cluster | null | undefined;
  role?: ClusterRole | null;
  manager?: string | null;
  size?: number;
  className?: string;
}) {
  if (!cluster) return null;
  const s = CLUSTER_STYLE[cluster];
  const letters = clusterBadgeLetters(cluster, role);
  const label = clusterRoleLabel(cluster, role);
  return (
    <span
      className={className}
      title={`${label}${manager ? ` · manager ${manager}` : ''}`}
      aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: size, height: size, padding: letters.length > 1 ? '0 3px' : 0,
        borderRadius: 3, flex: '0 0 auto',
        fontSize: Math.round(size * (letters.length > 1 ? 0.52 : 0.64)), fontWeight: 800, lineHeight: 1,
        letterSpacing: letters.length > 1 ? '0.02em' : undefined,
        background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
        verticalAlign: 'middle',
      }}
    >
      {letters}
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
      <ClusterBadge cluster={info?.cluster} role={info?.role} manager={info?.managerName} size={size} />
    </span>
  );
}
