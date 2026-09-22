// Profile page palette — light, warm ("light yellow") per user 2026-09-22.
// The profile is the one screen off the V5/Linear theme tokens; every
// inline colour on it and on its cards comes from here.
export const PT = {
  page:       'radial-gradient(ellipse at top, #fff6d5 0%, #fdfaf0 55%), #fdfaf0',
  text:       '#1f2937',
  panel:      '#fffdf5',
  panelBorder:'rgba(120, 90, 20, 0.16)',
  headerBg:   'linear-gradient(135deg, #fff1b8 0%, #fffaf0 100%)',
  headerBorder:'rgba(120, 90, 20, 0.22)',
  track:      'rgba(120, 90, 20, 0.12)',
  chipBg:     'rgba(124, 58, 237, 0.12)',
  chipText:   '#5b21b6',
  chipBorder: 'rgba(124, 58, 237, 0.35)',
  lockedBg:   'rgba(120, 90, 20, 0.05)',
  lockedText: 'rgba(31, 41, 55, 0.5)',
  lockedBorder:'rgba(120, 90, 20, 0.12)',
  inputBg:    '#ffffff',
  inputBorder:'rgba(120, 90, 20, 0.3)',
  danger:     '#b91c1c',
  ok:         { bg: 'rgba(16,185,129,0.15)',  text: '#047857' },
  warn:       { bg: 'rgba(245,158,11,0.2)',   text: '#92400e' },
  bad:        { bg: 'rgba(239,68,68,0.14)',   text: '#b91c1c' },
  button:     '#7c3aed',
} as const;
export const panel = { background: PT.panel, border: `1px solid ${PT.panelBorder}` } as const;
export const input = { background: PT.inputBg, border: `1px solid ${PT.inputBorder}`, color: PT.text, borderRadius: 6, padding: '4px 8px', fontSize: 13 } as const;
