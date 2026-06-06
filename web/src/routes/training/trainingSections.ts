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

/** Problem-based training: each real-world problem demands one or more of these
 *  cognitive types. A tech's proficiency is tracked per problem × per type, so a
 *  gap points straight at how to coach: memory → drill, technical → hands-on,
 *  logic → walk through the diagnosis. */
export const PROBLEM_TYPES = ['memory', 'technical', 'logic'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

// localStorage draft keys, ANCHORED to a real entity id. Passed to useLocalDraft
// (which prefixes `cove.training.draft:`). Anchoring to the real id is what makes
// locking a format later a mechanical import rather than re-entry.
export const draftKey = {
  equipmentSop: (equipmentId: string) => `sop:equipment:${equipmentId}`,
  equipmentProblems: (equipmentId: string) => `problems:equipment:${equipmentId}`,
  techCompetency: (techId: string) => `skill:competency:${techId}`,
  techProblems: (techId: string) => `problems:tech:${techId}`,
  techCerts: (techId: string) => `skill:certs:${techId}`,
  techCourses: (techId: string) => `skill:courses:${techId}`,
  techSignoffs: (techId: string) => `skill:signoffs:${techId}`,
};
