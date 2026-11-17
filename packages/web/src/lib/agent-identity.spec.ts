import { describe, expect, it } from '@rstest/core';

import { agentIdentity, TEAM_ROLES } from './agent-identity.js';


describe('agentIdentity', () => {
  it('should give every team role its own mark, stage and color', () => {
    const identities = TEAM_ROLES.map(role => agentIdentity(role));

    expect(new Set(identities.map(identity => identity.mark)).size).toBe(TEAM_ROLES.length);
    expect(identities.map(identity => identity.stage)).toEqual(['Leads', 'Idea', 'Plan', 'Build', 'Review', 'Test', 'Ship', 'Environment']);
    expect(new Set(identities.map(identity => identity.color)).size).toBe(TEAM_ROLES.length);
  });

  it('should describe the developer in plain words', () => {
    expect(agentIdentity('DEVELOPER')).toMatchObject({
      mark: 'dev',
      label: 'Developer',
      tagline: 'Writes the code',
      responsibility: 'Builds the plan, writes the tests, and fixes what the review finds.',
    });
  });

  it('should fall back to the generic mark and a stable color for an unknown role', () => {
    const first = agentIdentity('DESIGNER', 'Designer Agent');

    expect(first).toMatchObject({ mark: 'generic', label: 'Designer Agent', stage: 'Helps' });
    expect(first.color).toMatch(/^oklch\(/);
    expect(agentIdentity('DESIGNER').color).toBe(first.color);
    expect(agentIdentity('DESIGNER').label).toBe('DESIGNER');
  });
});
