// Admin "view as user" impersonation — shared context.
//
// Kept in its own dependency-light module (no imports from useMe) so the
// identity hooks can read it without an import cycle. The provider, banner,
// switcher and phone-frame shell live in components/Impersonation.tsx.
//
// Impersonation is a CLIENT-SIDE effective-user override: the real Supabase
// session stays the admin, so reads work (RLS is permissive for authed
// reads) and faithfully reproduce what the target user SEES. Writes still
// execute as the admin — hence the per-action `actAsMe` gate, off by default.
import { createContext, useContext } from 'react';

export type ForceDevice = 'mobile' | 'pc' | null;

export type ImpersonationValue = {
  /** users.id of the user being viewed-as, or null when not impersonating. */
  impersonatedUserId: string | null;
  /** Override the responsive breakpoint for layout testing. */
  forceDevice: ForceDevice;
  /** Per-action escape hatch. When false (default) mutations are blocked
   *  while impersonating; when true the admin can act as the target user. */
  actAsMe: boolean;

  isImpersonating: boolean;
  /** True when an action is allowed: not impersonating, or actAsMe enabled. */
  canAct: boolean;

  start: (userId: string) => void;
  stop: () => void;
  setForceDevice: (d: ForceDevice) => void;
  setActAsMe: (v: boolean) => void;
};

const INERT: ImpersonationValue = {
  impersonatedUserId: null,
  forceDevice: null,
  actAsMe: false,
  isImpersonating: false,
  canAct: true,
  start: () => {},
  stop: () => {},
  setForceDevice: () => {},
  setActAsMe: () => {},
};

export const ImpersonationCtx = createContext<ImpersonationValue>(INERT);

/** Safe to call without a provider — returns inert defaults (no impersonation,
 *  actions allowed, viewport-driven device). */
export function useImpersonation(): ImpersonationValue {
  return useContext(ImpersonationCtx);
}
