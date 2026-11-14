import { detail, summary } from '../test/artifact-fixtures.js';

import { artifactsReducer, initialArtifactsState } from './artifacts-reducer.js';


describe('artifactsReducer', () => {
  const listed = artifactsReducer(initialArtifactsState, {
    type: 'artifacts.list',
    conversationId: 'c1',
    artifacts: [summary({ id: 'T-1' }), summary({ id: 'T-2' })],
  });

  it('replaces the board of a conversation with each list', () => {
    expect(listed.boards.c1.loaded).toBe(true);
    expect(Object.keys(listed.boards.c1.byId)).toEqual(['T-1', 'T-2']);
    const other = artifactsReducer(listed, { type: 'artifacts.list', conversationId: 'c2', artifacts: [] });
    expect(Object.keys(other.boards.c1.byId)).toEqual(['T-1', 'T-2']);
  });

  it('keeps the project folders', () => {
    expect(artifactsReducer(listed, { type: 'projects.list', projects: ['app'] }).projects).toEqual(['app']);
  });

  it('stores a detail and its summary', () => {
    const state = artifactsReducer(listed, { type: 'artifact.detail', conversationId: 'c1', artifact: detail({ id: 'T-3', sections: { overview: 'Why' } }) });
    expect(state.boards.c1.details['T-3'].sections).toEqual({ overview: 'Why' });
    expect(state.boards.c1.byId['T-3']).toEqual(summary({ id: 'T-3' }));
  });

  it('applies an update to its own conversation, summary and open detail', () => {
    const opened = artifactsReducer(listed, { type: 'artifact.detail', conversationId: 'c1', artifact: detail({ id: 'T-1', sections: { overview: 'Why' } }) });
    const state = artifactsReducer(opened, { type: 'artifact.updated', conversationId: 'c1', artifact: summary({ id: 'T-1', status: 'ready' }) });
    expect(state.boards.c1.byId['T-1'].status).toBe('ready');
    expect(state.boards.c1.details['T-1']).toMatchObject({ status: 'ready', sections: { overview: 'Why' } });
    const other = artifactsReducer(state, { type: 'artifact.updated', conversationId: 'c2', artifact: summary({ id: 'T-1', status: 'done' }) });
    expect(other.boards.c1.byId['T-1'].status).toBe('ready');
    expect(other.boards.c2).toMatchObject({ loaded: false, details: {} });
  });

  it('forgets a deleted artifact', () => {
    const opened = artifactsReducer(listed, { type: 'artifact.detail', conversationId: 'c1', artifact: detail({ id: 'T-1' }) });
    const state = artifactsReducer(opened, { type: 'artifact.deleted', conversationId: 'c1', id: 'T-1' });
    expect(state.boards.c1.byId['T-1']).toBeUndefined();
    expect(state.boards.c1.details['T-1']).toBeUndefined();
  });

  it('ignores other events', () => {
    expect(artifactsReducer(listed, { type: 'auth.ok' })).toBe(listed);
  });
});
