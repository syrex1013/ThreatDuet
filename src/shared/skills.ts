/** A skill Duet can load: instructions in a SKILL.md, from a public GitHub folder. */
export interface CuratedSkill {
  id: string;
  name: string;
  blurb: string;
  /** GitHub folder holding SKILL.md. */
  repo: string;
  ref: string;
  path: string;
}

/**
 * Only skills that work as instructions: Duet has no shell, so skills that depend on running
 * scripts (pdf, docx, pptx, xlsx) are left out.
 */
export const CURATED_SKILLS: CuratedSkill[] = [
  { id: 'doc-coauthoring', name: 'Co-author documents', blurb: 'A structured way to draft docs, specs and proposals with you', repo: 'anthropics/skills', ref: 'main', path: 'skills/doc-coauthoring' },
  { id: 'internal-comms', name: 'Internal communications', blurb: 'Status updates, newsletters, FAQs and 3P updates in the usual formats', repo: 'anthropics/skills', ref: 'main', path: 'skills/internal-comms' },
  { id: 'frontend-design', name: 'Frontend design', blurb: 'Distinctive, intentional visual design instead of templated defaults', repo: 'anthropics/skills', ref: 'main', path: 'skills/frontend-design' },
  { id: 'mcp-builder', name: 'MCP builder', blurb: 'How to design and write a good MCP server', repo: 'anthropics/skills', ref: 'main', path: 'skills/mcp-builder' },
  { id: 'skill-creator', name: 'Skill creator', blurb: 'Write and improve skills of your own', repo: 'anthropics/skills', ref: 'main', path: 'skills/skill-creator' },
];

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  body: string;
  source: string;
}
