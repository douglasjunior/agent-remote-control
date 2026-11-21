import { describe, expect, it } from '@rstest/core';

import type { ArtifactActor, ArtifactHistoryEvent } from '../../artifacts/models/artifact.model.js';
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
    { url: 'https://x/pull/1', title: 'T-1: API', repository: '.', state: 'open', addedAt: ARTIFACT_AT },
    { url: 'https://x/pull/2', repository: 'repositories/web', state: 'merged', addedAt: ARTIFACT_AT },
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
  it('should write one line per artifact with what routes the work', () => {
    expect(formatter.summaryLine(api, all)).toBe(
      '- T-1 [task] "API" · status: in_review · project: shop · parent: F-1 · depends on: T-2 (done), T-9 (deleted) · refinement: business done, design done, technical done · with: CODE_REVIEWER · pull requests: 2',
    );
    expect(formatter.summaryLine(buildArtifact({ id: 'T-3', dependsOn: ['T-1', 'T-2'] }), all)).toContain('· depends on: T-1 (in_review), T-2 (done) · waiting on: T-1 ·');
    expect(formatter.summaryLine(buildArtifact({ id: 'F-2', type: 'feature', projectNames: ['shop', 'web'] }), all)).toContain('· projects: shop, web ·');
    expect(formatter.summaryLine(feature, all)).toBe('- F-1 [feature] "Checkout" · status: in_progress · projects: shop · refinement: business done, design done, technical done');
    expect(formatter.list([], all)).toBe('No artifact matches.');
    expect(formatter.list([feature, cart], all).split('\n')).toHaveLength(2);
  });

  it('should render the full content of a task, its sections in catalog order and its comments', () => {
    expect(formatter.detail(api, all)).toBe([
      '# T-1 · API',
      [
        '- Type: task',
        '- Status: in_review',
        '- Project: shop',
        '- Parent: F-1 "Checkout" (feature)',
        '- Depends on: T-2 "Cart" (done); T-9 (deleted)',
        '- Blocks: none',
        '- Refinement: business done, design done, technical done',
        `- With: Code Reviewer (CODE_REVIEWER) since ${ARTIFACT_AT}`,
        '- Branch: feat/t-1',
        '- Pull requests: https://x/pull/1 (open) "T-1: API"; https://x/pull/2 (merged, repository repositories/web)',
      ].join('\n'),
      '## Overview\nExpose the cart.',
      '## Technical solution\nUse REST.',
      `## Comments\n- ${ARTIFACT_AT} CEO: Go.\n- ${ARTIFACT_AT} user (web): Careful.\n- ${ARTIFACT_AT} system: Restarted.`,
    ].join('\n\n'));
  });

  it('should say when the user set the current status', () => {
    const moved = (actor: ArtifactActor) => buildArtifact({
      id: 'T-4',
      status: 'blocked',
      history: [{ id: 'h', at: ARTIFACT_AT, actor, kind: 'updated', summary: 'Status', changes: [{ field: 'status', from: 'ready', to: 'blocked' }] }],
    });

    expect(formatter.detail(moved({ kind: 'user', channel: 'web' }), all)).toContain('- Status: blocked, set by the user\n');
    expect(formatter.detail(moved({ kind: 'agent', role: 'CEO', roleName: 'CEO' }), all)).toContain('- Status: blocked\n');
  });

  it('should list the tasks of a feature, or render each in full for a tree', () => {
    const own = formatter.detail(feature, all);
    expect(own).toContain('- Children:\n  - T-1 [task] "API"');
    expect(own).toContain('- Blocks: none');
    expect(formatter.detail(cart, all)).toContain('- Blocks: T-1 "API" (in_review)');
    expect(formatter.detail(cart, all)).toContain('No section written yet.');

    const tree = formatter.detail(feature, all, true).split('\n\n---\n\n');
    expect(tree.map(part => part.split('\n')[0])).toEqual(['# F-1 · Checkout', '# T-1 · API', '# T-2 · Cart']);
    expect(tree[0]).not.toContain('- Children:');
  });

  describe('digest', () => {
    it('should say so when the board has nothing open', () => {
      expect(formatter.digest([])).toBe('No open artifact.');
      expect(formatter.digest([cart, buildArtifact({ id: 'T-3', status: 'cancelled' })])).toBe('No open artifact.');
    });

    it('should list the open artifacts under way, features first and each group in numeric id order', () => {
      const second = buildArtifact({ id: 'F-10', type: 'feature', status: 'backlog' });
      const late = buildArtifact({ id: 'T-10', status: 'blocked' });

      const lines = formatter.digest([late, api, second, feature, cart]).split('\n');

      expect(lines.map(line => line.split(' ')[1])).toEqual(['F-1', 'F-10', 'T-1', 'T-10']);
    });

    it('should write a compact line for each feature and each task under way', () => {
      const standalone = buildArtifact({ id: 'T-4', title: 'Docs', status: 'changes_requested', projectName: 'site', dependsOn: ['T-5'] });
      const dependency = buildArtifact({ id: 'T-5', status: 'ready' });

      expect(formatter.digest([feature, api, cart, standalone, dependency]).split('\n').slice(0, 3)).toEqual([
        '- F-1 [feature] "Checkout" · status: in_progress · projects: shop',
        '- T-1 [task] "API" · status: in_review · feature: F-1 · project: shop · with: CODE_REVIEWER · pull requests: 2',
        '- T-4 [task] "Docs" · status: changes_requested · project: site · waiting on: T-5',
      ]);
    });

    it('should group the ready tasks by feature and the backlog tasks with what they owe', () => {
      const board = [
        buildArtifact({ id: 'F-2', type: 'feature', status: 'in_progress' }),
        buildArtifact({ id: 'F-1', type: 'feature', status: 'in_progress' }),
        buildArtifact({ id: 'T-9', status: 'ready' }),
        buildArtifact({ id: 'T-6', parentId: 'F-1', status: 'ready' }),
        buildArtifact({ id: 'T-5', parentId: 'F-1', status: 'ready' }),
        buildArtifact({ id: 'T-12', parentId: 'F-2', status: 'ready' }),
        buildArtifact({ id: 'T-10', status: 'ready' }),
        buildArtifact({ id: 'T-8', status: 'backlog', refinement: { business: 'pending', design: 'pending', technical: 'pending' } }),
        buildArtifact({ id: 'T-7', parentId: 'F-1', status: 'backlog', refinement: { business: 'done', design: 'skipped', technical: 'pending' } }),
        buildArtifact({ id: 'T-11', parentId: 'F-1', status: 'backlog', refinement: { business: 'pending', design: 'pending', technical: 'skipped' } }),
        buildArtifact({ id: 'T-13', status: 'backlog' }),
        buildArtifact({ id: 'T-14', parentId: 'F-2', status: 'backlog' }),
      ];

      expect(formatter.digest(board).split('\n').slice(2)).toEqual([
        'Ready: T-5, T-6 (F-1); T-12 (F-2); T-9, T-10',
        'Backlog: T-7 (F-1, owes technical refinement); T-8 (owes business, design and technical refinement); T-11 (F-1, owes business and design refinement); T-13; T-14 (F-2)',
      ]);
    });

    it('should leave the ready and backlog lines out when no task is in them', () => {
      expect(formatter.digest([feature, api, cart]).split('\n')).toHaveLength(2);
    });
  });

  describe('changesSince', () => {
    const EARLY = '2026-01-01T00:00:00.000Z';
    const ENDED = '2026-01-01T01:00:00.000Z';
    const LATE = '2026-01-01T02:00:00.000Z';
    const agent = (role: string): ArtifactActor => ({ kind: 'agent', role, roleName: role });
    const sectionChange = (id: string, at: string, section: string, to: string): ArtifactHistoryEvent =>
      ({ id, at, actor: agent('CODE_REVIEWER'), kind: 'updated', summary: 'Updated', changes: [{ field: `section:${section}`, to }] });
    const comment = (id: string, at: string, text: string): ArtifactHistoryEvent => ({ id, at, actor: agent('CODE_REVIEWER'), kind: 'commented', summary: 'Commented', text });
    const task = (history: readonly ArtifactHistoryEvent[]) => buildArtifact({
      id: 'T-5',
      title: 'Login',
      status: 'changes_requested',
      dependsOn: ['T-2'],
      refinement: { business: 'done', design: 'skipped', technical: 'skipped' },
      branch: 'feat/t-5',
      assignee: { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd', since: ARTIFACT_AT },
      pullRequests: [{ url: 'https://x/pull/5', repository: '.', state: 'open', addedAt: ARTIFACT_AT }],
      sections: { overview: 'Sign in.', technical_solution: 'Use JWT.', implementation_notes: 'On feat/t-5.' },
      history,
    });
    const facts = [
      '# T-5 · Login',
      '',
      '- Status: changes_requested',
      '- Depends on: T-2 "Cart" (done)',
      '- Refinement: business done, design skipped, technical skipped',
      `- With: Developer (DEVELOPER) since ${ARTIFACT_AT}`,
      '- Branch: feat/t-5',
      '- Pull requests: https://x/pull/5 (open)',
    ].join('\n');

    it('should give the facts, refinements and dependencies included, and say that nothing else changed when nothing did', () => {
      expect(formatter.changesSince(task([sectionChange('h1', EARLY, 'implementation_notes', 'replaced')]), all, ENDED)).toBe(
        `${facts}\n\nNothing on T-5 besides the facts above changed since you last worked on it.`,
      );
    });

    it('should carry only the sections changed and the comments added from the moment given on, that moment included', () => {
      const history = [
        comment('h1', EARLY, 'Before.'),
        sectionChange('h2', EARLY, 'overview', 'replaced'),
        sectionChange('h3', ENDED, 'technical_solution', 'appended'),
        comment('h4', LATE, 'Missing a test.'),
        sectionChange('h5', LATE, 'test_cases', 'cleared'),
      ];

      expect(formatter.changesSince(task(history), all, ENDED)).toBe([
        facts,
        'Below are only the sections changed and the comments added since you last worked on T-5; everything else on it is unchanged.',
        '## Test cases\nCleared.',
        '## Technical solution\nUse JWT.',
        `## Comments\n- ${LATE} CODE_REVIEWER: Missing a test.`,
      ].join('\n\n'));
    });
  });
});
