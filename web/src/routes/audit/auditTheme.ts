// §05 PM Audit — the design canvas's palette ("COVE PM Audit UI"), kept in
// one place so the three screens read as one section. Text/background pairs
// are the canvas's own (all ≥ 4.5:1).
import type { CSSProperties } from 'react';
import type { ChipTone, Verdict } from '../../lib/pmAudit';

export const A = {
  bg: '#F6F7F9',
  card: '#FFFFFF',
  line: '#E3E6EB',
  lineSoft: '#EEF0F3',
  control: '#D5D8DE',
  ink: '#141413',
  muted: '#5F6368',
  faint: '#9AA0A8',
  blue: '#1F5FBF',
  blueDark: '#174A96',
  blueSoft: '#E8F0FC',
  red: '#B42318',
  redDark: '#912018',
  redSoft: '#FEE4E2',
  orange: '#B45309',
  orangeDark: '#8A4B0A',
  orangeSoft: '#FEF3E2',
  track: '#EEF0F3',
} as const;

export const CHIP_TONE: Record<ChipTone, { bg: string; fg: string }> = {
  red: { bg: A.redSoft, fg: A.redDark },
  orange: { bg: A.orangeSoft, fg: A.orangeDark },
  blue: { bg: A.blueSoft, fg: A.blueDark },
  grey: { bg: A.lineSoft, fg: A.muted },
};

export const VERDICT_TONE: Record<Verdict, { bg: string; fg: string; border: string; glyph: string }> = {
  pass: { bg: A.blueSoft, fg: A.blueDark, border: A.blue, glyph: '✓' },
  coach: { bg: A.orangeSoft, fg: A.orangeDark, border: A.orange, glyph: '◐' },
  fail: { bg: A.redSoft, fg: A.redDark, border: A.red, glyph: '✕' },
};

export const font = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const cardStyle: CSSProperties = { background: A.card, border: `1px solid ${A.line}`, borderRadius: 12 };

export const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 600, color: A.muted, textTransform: 'uppercase', letterSpacing: '0.06em',
};

export const buttonStyle: CSSProperties = {
  height: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${A.control}`, background: A.card,
  font: `500 13px ${font}`, color: A.ink, cursor: 'pointer', whiteSpace: 'nowrap',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
};

export const primaryButtonStyle: CSSProperties = {
  ...buttonStyle, border: `1px solid ${A.blue}`, background: A.blue, color: '#FFFFFF', fontWeight: 600,
};

export const selectStyle: CSSProperties = {
  height: 44, padding: '0 12px', borderRadius: 8, border: `1px solid ${A.control}`, background: A.card,
  font: `500 13px ${font}`, color: A.ink, maxWidth: '100%',
};

export const thStyle: CSSProperties = {
  padding: '14px 12px', borderBottom: `1px solid ${A.line}`, fontWeight: 600, textAlign: 'left',
  color: A.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
};

export const tdStyle: CSSProperties = { padding: '14px 12px', borderBottom: `1px solid ${A.lineSoft}`, verticalAlign: 'top' };

export const tileGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 };
