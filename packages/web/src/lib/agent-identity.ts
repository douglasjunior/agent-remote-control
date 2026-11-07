export type MarkId = 'ceo' | 'po' | 'lead' | 'dev' | 'review' | 'git' | 'generic';

export interface AgentIdentity {
  /** Which glyph `AgentMark` draws. */
  readonly mark: MarkId;
  readonly label: string;
  readonly tagline: string;
  /** Where the role sits in the production line, from idea to shipped. */
  readonly stage: string;
  /** What the role is for, in plain words. */
  readonly responsibility: string;
  readonly example: string;
  /** A CSS color: a theme token for known roles, a hue derived from the role for the others. */
  readonly color: string;
}

const KNOWN_IDENTITIES: Readonly<Record<string, AgentIdentity>> = {
  CEO: {
    mark: 'ceo',
    label: 'Coordinator',
    tagline: 'Leads the team and talks to you',
    stage: 'Leads',
    responsibility: 'Understands what you want, picks who does what, and checks every result before it reaches you.',
    example: 'What can you do for this project?',
    color: 'var(--agent-ceo)',
  },
  PRODUCT_OWNER: {
    mark: 'po',
    label: 'Product Owner',
    tagline: 'Figures out what to build',
    stage: 'Idea',
    responsibility: 'Turns your idea into clear requirements and asks you what only you can decide.',
    example: 'Help me define a new feature',
    color: 'var(--agent-product-owner)',
  },
  TECH_LEAD: {
    mark: 'lead',
    label: 'Tech Lead',
    tagline: 'Plans how to build it',
    stage: 'Plan',
    responsibility: 'Chooses the technical approach and splits the work into steps a developer can follow.',
    example: 'Plan how to add a login screen',
    color: 'var(--agent-tech-lead)',
  },
  DEVELOPER: {
    mark: 'dev',
    label: 'Developer',
    tagline: 'Writes the code',
    stage: 'Build',
    responsibility: 'Builds the plan, writes the tests, and fixes what the review finds.',
    example: 'Fix the failing tests',
    color: 'var(--agent-developer)',
  },
  CODE_REVIEWER: {
    mark: 'review',
    label: 'Reviewer',
    tagline: 'Checks quality and safety',
    stage: 'Review',
    responsibility: 'Inspects the work with fresh eyes and sends it back when something is wrong.',
    example: 'Review my latest changes',
    color: 'var(--agent-code-reviewer)',
  },
  GIT_OPS: {
    mark: 'git',
    label: 'Git Ops',
    tagline: 'Syncs and delivers the code',
    stage: 'Ship',
    responsibility: 'Prepares the repository and opens the pull request that delivers the work.',
    example: 'Clone a repository for me',
    color: 'var(--agent-git-ops)',
  },
};

/** Order in which the team is presented. */
export const TEAM_ROLES: readonly string[] = Object.keys(KNOWN_IDENTITIES);

function hueOf(role: string) {
  let hash = 0;
  for (const char of role) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

export function agentIdentity(role: string, roleName?: string): AgentIdentity {
  return KNOWN_IDENTITIES[role] ?? {
    mark: 'generic',
    label: roleName ?? role,
    tagline: 'Helps the team',
    stage: 'Helps',
    responsibility: 'Takes on the work the Coordinator hands over and reports back.',
    example: 'Ask for help',
    color: `oklch(0.62 0.15 ${hueOf(role)})`,
  };
}
