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

/** Problem-based training axes — the supervisor's own definitions:
 *   memory        = just follow the SOP from memory; no diagnosis or special skill
 *                   (isolate sand filters, switch chillers, generator / load-bank /
 *                   water-treatment test, reset AHU or VFD, on-call SOP).
 *   technical     = hands-on skill AND troubleshooting (pump/motor rebuild,
 *                   actuator replacement, diagnosing why a VFD or freezestat tripped).
 *   rule_of_thumb = finish the PM/repair with NO operation interruption and NO
 *                   alarm / limit alarm — the experienced touch.
 *  A problem is tagged with the axes it demands; a tech's proficiency is scored
 *  per problem × per axis (0-4), so a gap points straight at how to coach. */
export const PROBLEM_TYPES = ['memory', 'technical', 'rule_of_thumb'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

export const PROBLEM_TYPE_META: { key: ProblemType; label: string; blurb: string }[] = [
  { key: 'memory', label: 'Memory', blurb: 'follow the SOP from memory — no diagnosis or special skill (isolate sand filters, switch chillers, generator / load-bank / water test, reset AHU or VFD, on-call SOP).' },
  { key: 'technical', label: 'Technical', blurb: 'hands-on skill + troubleshooting (pump/motor rebuild, actuator swap, diagnosing why a VFD or freezestat tripped).' },
  { key: 'rule_of_thumb', label: 'Rule of thumb', blurb: 'finish the PM/repair with no operation interruption and no alarms / limit alarms.' },
];

/** Basic trade-skill knowledge — the foundational competence axes, scored per
 *  tech (0-4) across ALL five (a tech has some level in each, not just one
 *  primary discipline). This is the substrate beneath per-problem proficiency: a
 *  weak basic skill explains why a tech struggles with the problems that draw on
 *  it. Distinct from engineer_profiles.discipline (a single primary M/E/P/BMS/FLS). */
export const BASIC_SKILLS = ['electrical', 'refrigeration', 'mechanical', 'control', 'plumbing'] as const;
export type BasicSkill = (typeof BASIC_SKILLS)[number];

// localStorage draft keys, ANCHORED to a real entity id. Passed to useLocalDraft
// (which prefixes `cove.training.draft:`). Anchoring to the real id is what makes
// locking a format later a mechanical import rather than re-entry.
export const draftKey = {
  equipmentSop: (equipmentId: string) => `sop:equipment:${equipmentId}`,
  equipmentProblems: (equipmentId: string) => `problems:equipment:${equipmentId}`,
  techCompetency: (techId: string) => `skill:competency:${techId}`,
  techProblems: (techId: string) => `problems:tech:${techId}`,
  techBasics: (techId: string) => `skill:basics:${techId}`,
  techCerts: (techId: string) => `skill:certs:${techId}`,
  techCourses: (techId: string) => `skill:courses:${techId}`,
  techSignoffs: (techId: string) => `skill:signoffs:${techId}`,
};
