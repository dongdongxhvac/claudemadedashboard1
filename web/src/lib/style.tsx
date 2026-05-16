// StyleProvider: writes data-style on <html> + persists choice in localStorage.
// User preference moves to Supabase (users.preferences.style_overrides) in Phase 3
// once the users table exists.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Style = 'v5' | 'linear';
export const STYLES: { value: Style; label: string }[] = [
  { value: 'v5',     label: 'V5 (airy)' },
  { value: 'linear', label: 'Linear (dense)' },
];

const STORAGE_KEY = 'cove.style';
const DEFAULT_STYLE: Style = 'v5';

type Ctx = { style: Style; setStyle: (s: Style) => void };
const StyleCtx = createContext<Ctx | null>(null);

export function StyleProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState<Style>(() => {
    if (typeof window === 'undefined') return DEFAULT_STYLE;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (stored === 'linear' || stored === 'v5') ? stored : DEFAULT_STYLE;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-style', style);
    window.localStorage.setItem(STORAGE_KEY, style);
  }, [style]);

  return <StyleCtx.Provider value={{ style, setStyle }}>{children}</StyleCtx.Provider>;
}

export function useStyle(): Ctx {
  const v = useContext(StyleCtx);
  if (!v) throw new Error('useStyle must be inside <StyleProvider>');
  return v;
}
