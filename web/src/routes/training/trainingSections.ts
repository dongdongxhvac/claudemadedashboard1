import type { SectionKey } from '../../hooks/useBuildingKb';

// Shared constants for the Training view. Kept here so the per-building panel
// doesn't duplicate the SOP sub-tab order from buildings/Detail.tsx.

/** Building-level SOP sub-tab order (the real building_section_notes sections).
 *  Same order as buildings/Detail.tsx. 'inventory' is its own building tab, so
 *  it's intentionally omitted from the SOP strip. */
export const SOP_SECTION_KEYS: SectionKey[] = [
  'overview',
  'mechanical',
  'control',
  'electrical',
  'plumbing',
  'access',
  'troubleshooting',
];

/** The competency / SOP facets — the training spine. An equipment SOP is
 *  sectioned by these, and competency is tracked per facet. */
export const FACETS = ['PM', 'Reset', 'Support', 'Knowledge'] as const;
export type Facet = (typeof FACETS)[number];
export const FACET_HINT = FACETS.join(' / ');

// localStorage draft keys, ANCHORED to a real entity id. Passed to useLocalDraft
// (which prefixes `cove.training.draft:`). Anchoring to the real id is what makes
// locking a format later a mechanical import rather than re-entry.
export const draftKey = {
  equipmentSop: (equipmentId: string) => `sop:equipment:${equipmentId}`,
  techCompetency: (techId: string) => `skill:competency:${techId}`,
  techCerts: (techId: string) => `skill:certs:${techId}`,
  techCourses: (techId: string) => `skill:courses:${techId}`,
  techSignoffs: (techId: string) => `skill:signoffs:${techId}`,
};
