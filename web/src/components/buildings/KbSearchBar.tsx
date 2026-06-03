// Cross-building knowledge-base search.
//
// Lives on the /buildings index page. Searches equipment, parts, and
// section notes by title + body via the v_buildings_kb_search view.
// Results group by building so the engineer can see where each hit lives.
//
// V1 uses plain ilike with min 2-character query. The dataset is small
// (~15 buildings × ~50 entities = ~750 rows) so this stays fast without
// tsvector / GIN.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useKbSearch, type KbSearchHit } from '../../hooks/useBuildingKb';

const KIND_LABEL: Record<KbSearchHit['kind'], string> = {
  equipment: 'equipment',
  part:      'part',
  section:   'note',
  issue:     'past fix',
};

const KIND_COLOR: Record<KbSearchHit['kind'], string> = {
  equipment: 'var(--color-text)',
  part:      'var(--color-accent)',
  section:   'var(--color-text-muted)',
  // Green tint — "this problem has been solved before, here's how"
  issue:     'var(--color-ok, #10b981)',
};

function highlight(text: string | null, q: string): React.ReactNode {
  if (!text) return null;
  if (q.length < 2) return text;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? <mark key={i} style={{ background: 'rgba(217,119,6,0.25)', color: 'inherit' }}>{p}</mark> : <span key={i}>{p}</span>,
  );
}

export function KbSearchBar() {
  const [query, setQuery] = useState('');
  const resultsQ = useKbSearch(query);

  const groupedByBuilding = useMemo(() => {
    const m = new Map<string, { short: string | null; name: string; hits: KbSearchHit[] }>();
    for (const r of resultsQ.data ?? []) {
      const g = m.get(r.building_id) ?? {
        short: r.building_short_code,
        name: r.building_name,
        hits: [],
      };
      g.hits.push(r);
      m.set(r.building_id, g);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => {
      const an = parseInt((a.short ?? a.name).match(/^(\d+)/)?.[1] ?? '', 10);
      const bn = parseInt((b.short ?? b.name).match(/^(\d+)/)?.[1] ?? '', 10);
      const na = Number.isFinite(an) ? an : Number.POSITIVE_INFINITY;
      const nb = Number.isFinite(bn) ? bn : Number.POSITIVE_INFINITY;
      if (na !== nb) return na - nb;
      return (a.short ?? a.name).localeCompare(b.short ?? b.name);
    });
  }, [resultsQ.data]);

  return (
    <div className="mb-5">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search equipment, parts, notes across all buildings…"
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: '0.95rem',
          borderRadius: 6,
          border: '1px solid var(--color-border)',
          background: 'var(--color-card)',
          color: 'var(--color-text)',
        }}
      />
      {query.trim().length >= 2 && (
        <div className="mt-3">
          {resultsQ.isLoading ? (
            <p className="t-small t-muted">Searching…</p>
          ) : resultsQ.error ? (
            <p className="t-small t-danger">Error: {(resultsQ.error as Error).message}</p>
          ) : groupedByBuilding.length === 0 ? (
            <p className="t-small t-muted">No matches.</p>
          ) : (
            <div className="t-card" style={{ padding: 14 }}>
              <div className="t-small t-muted uppercase tracking-wider mb-2">
                {resultsQ.data?.length ?? 0} match{(resultsQ.data?.length ?? 0) === 1 ? '' : 'es'} across {groupedByBuilding.length} building{groupedByBuilding.length === 1 ? '' : 's'}
              </div>
              {groupedByBuilding.map(([bid, g]) => (
                <div key={bid} className="mb-3">
                  <div className="t-small mb-1">
                    <Link
                      to={`/buildings/${encodeURIComponent(g.short ?? g.name)}`}
                      className="t-accent hover:underline"
                      style={{ fontWeight: 600 }}
                    >
                      {g.short && <span className="t-mono t-muted mr-1">{g.short}</span>}
                      {g.name}
                    </Link>
                  </div>
                  <ul style={{ marginLeft: 12, listStyle: 'none', paddingLeft: 0 }}>
                    {g.hits.map((h, i) => (
                      <li key={`${h.kind}-${h.entity_id ?? h.title}-${i}`} className="t-small mb-1">
                        <span
                          className="t-mono"
                          style={{ color: KIND_COLOR[h.kind], marginRight: 6 }}
                        >
                          [{KIND_LABEL[h.kind]}]
                        </span>
                        <span style={{ color: 'var(--color-text)' }}>{highlight(h.title, query)}</span>
                        {h.body && (
                          <span className="t-muted ml-2" style={{ fontSize: '0.75rem' }}>
                            — {highlight(h.body.slice(0, 140), query)}
                            {h.body.length > 140 && '…'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
