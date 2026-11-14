import { describe, expect, it } from 'vitest';

import { ARTIFACT_AT, buildArtifact } from '../../artifacts/testing/artifact.fixture.js';

import { ArtifactPromptFormatterService } from './artifact-prompt-formatter.service.js';


const formatter = new ArtifactPromptFormatterService();
const feature = buildArtifact({ id: 'F-1', type: 'feature', title: 'Checkout', status: 'in_progress', sections: { overview: 'Sell online.' } });
const api = buildArtifact({
  id: 'T-1',
  title: 'API',
  parentId: 'F-1',
  status: 'in_review',
  dependsOn: ['T-2', 'T-9'],
  assignee: { role: 'CODE_REVIEWER', roleName: 'Code Reviewer', delegationId: 'd', since: ARTIFACT_AT },
  branch: 'feat/t-1',
  pullRequests: [
    { url: 'https://x/pull/1', title: 'T-1: API', state: 'open', addedAt: ARTIFACT_AT },
    { url: 'https://x/pull/2', state: 'merged', addedAt: ARTIFACT_AT },
  ],
  sections: { technical_solution: 'Use REST.', overview: 'Expose the cart.' },
  history: [
    { id: 'h1', at: ARTIFACT_AT, actor: { kind: 'agent', role: 'CEO', roleName: 'CEO' }, kind: 'commented', summary: 'Commented', text: 'Go.' },
    { id: 'h2', at: ARTIFACT_AT, actor: { kind: 'user', channel: 'web' }, kind: 'commented', summary: 'Commented', text: 'Careful.' },
    { id: 'h3', at: ARTIFACT_AT, actor: { kind: 'system' }, kind: 'commented', summary: 'Commented', text: 'Restarted.' },
    { id: 'h4', at: ARTIFACT_AT, actor: { kind: 'system' }, kind: 'released', summary: 'Released' },
  ],
});
const cart = buildArtifact({ id: 'T-2', title: 'Cart', parentId: 'F-1', status: 'done', dependsOn: [] });
const all = [feature, api, cart];

describe('ArtifactPromptFormatterService', () => {
  it('writes one line per artifact with what routes the work', () => {
    expect(formatter.summaryLine(api, all)).toBe(
      '- T-1 [task] "API" · status: in_review · project: shop · parent: F-1 · depends on: T-2 (done), T-9 (deleted) · refinement: business done, technical done · with: CODE_REVIEWER · pull requests: 2',
    );
    expect(formatter.summaryLine(buildArtifact({ id: 'T-3', dependsOn: ['T-1', 'T-2'] }), all)).toContain('· depends on: T-1 (in_review), T-2 (done) · waiting on: T-1 ·');
    expect(formatter.summaryLine(feature, all)).toBe('- F-1 [feature] "Checkout" · status: in_progress · project: shop · refinement: business done, technical done');
    expect(formatter.list([], all)).toBe('No artifact matches.');
    expect(formatter.list([feature, cart], all).split('\n')).toHaveLength(2);
  });

  it('renders the full content of a task, its sections in catalog order and its comments', () => {
    expect(formatter.detail(api, all)).toBe([
      '# T-1 · API',
      [
        '- Type: task',
        '- Status: in_review',
        '- Project: shop',
        '- Parent: F-1 "Checkout" (feature)',
        '- Depends on: T-2 "Cart" (done); T-9 (deleted)',
        '- Blocks: none',
        '- Refinement: business done, technical done',
        `- With: Code Reviewer (CODE_REVIEWER) since ${ARTIFACT_AT}`,
        '- Branch: feat/t-1',
        '- Pull requests: https://x/pull/1 (open) "T-1: API"; https://x/pull/2 (merged)',
      ].join('\n'),
      '## Overview\nExpose the cart.',
      '## Technical solution\nUse REST.',
      `## Comments\n- ${ARTIFACT_AT} CEO: Go.\n- ${ARTIFACT_AT} user (web): Careful.\n- ${ARTIFACT_AT} system: Restarted.`,
    ].join('\n\n'));
  });

  it('lists the tasks of a feature, or renders each in full for a tree', () => {
    const own = formatter.detail(feature, all);
    expect(own).toContain('- Children:\n  - T-1 [task] "API"');
    expect(own).toContain('- Blocks: none');
    expect(formatter.detail(cart, all)).toContain('- Blocks: T-1 "API" (in_review)');
    expect(formatter.detail(cart, all)).toContain('No section written yet.');

    const tree = formatter.detail(feature, all, true).split('\n\n---\n\n');
    expect(tree.map(part => part.split('\n')[0])).toEqual(['# F-1 · Checkout', '# T-1 · API', '# T-2 · Cart']);
    expect(tree[0]).not.toContain('- Children:');
  });
});
