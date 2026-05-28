import { useEffect, useState } from 'react';
import { useImpersonation } from '../lib/impersonationContext';

/** True when the viewport is at-or-below `maxPx`. Tracks resize.
 *  An admin's impersonation "force device" toggle overrides the viewport so
 *  the phone layout can be previewed on a desktop (and vice-versa). */
export function useIsMobile(maxPx = 767): boolean {
  const { forceDevice } = useImpersonation();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(`(max-width: ${maxPx}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [maxPx]);

  if (forceDevice === 'mobile') return true;
  if (forceDevice === 'pc') return false;
  return isMobile;
}
