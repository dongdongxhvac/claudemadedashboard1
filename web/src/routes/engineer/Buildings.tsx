// /engineer/buildings — the engineer's own "Buildings" tab (2026-09-23).
//
// Kept off the My Day page on purpose (user: "tuck it away / separate tab"):
// a list of the site's buildings with this engineer's system sign-off
// progress, and the set-up sheet + sign-offs for whichever one is open.
// The sheet reads the Buildings KB; sign-offs are knowledge work_records.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useSiteBuildings } from '../../hooks/useSiteBuildings';
import { useWorkRecords, BUILDING_SYSTEMS, systemSignoffs } from '../../hooks/useWorkRecords';
import { BuildingSheet } from '../../components/profile/BuildingSheet';
import { SHEET } from '../../components/profile/sheetTheme';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export default function EngineerBuildings() {
  const { signOut } = useAuth();
  const me = useMe();
  const buildings = useSiteBuildings();
  const userId = me.data?.id;
  const recQ = useWorkRecords(userId);
  const [open, setOpen] = useState<string | null>(null);

  if (me.isLoading) return <Wrap><p style={{ padding: 24 }}>Loading…</p></Wrap>;
  if (!userId) return <Wrap><p style={{ padding: 24 }}>Your account isn't linked to a user row.</p></Wrap>;

  const records = recQ.data ?? [];
  const openB = buildings.find((b) => b.id === open) ?? null;
  const totalVerified = buildings.reduce((s, b) => s + BUILDING_SYSTEMS.filter((sys) => systemSignoffs(records, b.id).get(sys)?.status === 'verified').length, 0);

  return (
    <Wrap>
      <header style={{ padding: '12px 16px', borderBottom: `1px solid ${SHEET.ink}`, background: SHEET.band, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>My buildings</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: SHEET.mute }}>
            {me.data?.full_name} · {totalVerified} of {buildings.length * BUILDING_SYSTEMS.length} systems verified
          </p>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
          <Link to="/engineer/me" style={{ color: SHEET.ink }}>← My work</Link>
          <button onClick={signOut} style={{ background: 'none', border: 0, padding: 0, color: SHEET.ink, textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>Sign out</button>
        </div>
      </header>

      <main style={{ padding: '14px 16px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <p style={{ fontSize: 12.5, color: SHEET.mute, margin: '0 0 12px', maxWidth: 640 }}>
          Pick a building. Its set-up sheet comes from the Buildings KB; sign off each system after you've explained it in the office with a hand drawing. A lead verifies.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6, marginBottom: 16 }}>
          {buildings.map((b) => {
            const signs = systemSignoffs(records, b.id);
            const v = BUILDING_SYSTEMS.filter((s) => signs.get(s)?.status === 'verified').length;
            const p = BUILDING_SYSTEMS.filter((s) => signs.get(s)?.status === 'self').length;
            const isOpen = open === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setOpen(isOpen ? null : b.id)}
                style={{
                  textAlign: 'left', padding: '8px 10px', cursor: 'pointer', background: isOpen ? SHEET.ink : '#fff',
                  color: isOpen ? '#fff' : SHEET.ink, border: `1px solid ${isOpen ? SHEET.ink : SHEET.line}`, borderRadius: 3,
                }}
                title={b.name}
              >
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{b.short_code ?? b.code}</div>
                <div style={{ fontSize: 11, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                <div style={{ fontSize: 11, fontFamily: MONO, marginTop: 3, opacity: v || p ? 1 : 0.55 }}>
                  {v}/{BUILDING_SYSTEMS.length}{p ? ` · ${p} pending` : ''}
                </div>
              </button>
            );
          })}
        </div>

        {openB ? (
          <BuildingSheet
            buildingId={openB.id}
            buildingLabel={openB.short_code ?? openB.code}
            buildingName={openB.name}
            userId={userId}
            isSelf
            canVerify={false}
            onClose={() => setOpen(null)}
          />
        ) : (
          <p style={{ fontSize: 12.5, color: SHEET.faint, margin: 0 }}>No building open.</p>
        )}
      </main>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: SHEET.paper, color: SHEET.ink, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      {children}
    </div>
  );
}
