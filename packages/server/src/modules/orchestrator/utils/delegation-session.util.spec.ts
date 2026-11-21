import { describe, expect, it } from '@rstest/core';

import { startsNewTaskSession } from './delegation-session.util.js';


describe('delegation-session.util', () => {
  it('should start a new task session for an artifact delegation that asks for a new session', () => {
    expect(startsNewTaskSession({ artifactId: 'T-1', sessionMode: 'new' })).toBe(true);
  });

  it('should keep the session of the task when the delegation resumes or says nothing', () => {
    expect(startsNewTaskSession({ artifactId: 'T-1', sessionMode: 'resume' })).toBe(false);
    expect(startsNewTaskSession({ artifactId: 'T-1' })).toBe(false);
  });

  it('should leave the sessions of work without an artifact to their own rules', () => {
    expect(startsNewTaskSession({ sessionMode: 'new' })).toBe(false);
  });
});
