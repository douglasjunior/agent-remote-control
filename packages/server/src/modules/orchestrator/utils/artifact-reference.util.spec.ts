import { describe, expect, it } from '@rstest/core';

import { isNoneValue, normalizeArtifactId, readArtifactReference } from './artifact-reference.util.js';


describe('artifact-reference.util', () => {
  it('should write artifact ids in upper case and keep any other value as written', () => {
    expect(normalizeArtifactId('t-12')).toBe('T-12');
    expect(normalizeArtifactId('login-task')).toBe('login-task');
  });

  it('should read none, in any case, and an empty value as clearing the field', () => {
    expect(isNoneValue('')).toBe(true);
    expect(isNoneValue('NONE')).toBe(true);
    expect(isNoneValue('T-1')).toBe(false);
  });

  it('should read a parent as a normalized id or null', () => {
    expect(readArtifactReference('f-1')).toBe('F-1');
    expect(readArtifactReference('none')).toBeNull();
  });
});
