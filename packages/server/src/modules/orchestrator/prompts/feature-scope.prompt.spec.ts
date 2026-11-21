import { describe, expect, it } from '@rstest/core';

import { buildFeatureScopePrompt } from './feature-scope.prompt.js';


describe('feature-scope.prompt', () => {
  it('should limit the changes of an agent to the projects of its feature, with the workspace root readable', () => {
    expect(buildFeatureScopePrompt(['shop', 'api'])).toBe(
      'You work from the workspace root and may read all of it; you may change files only in these project folders: shop, api.',
    );
  });

  it('should name the folder of a feature with a single project in the singular', () => {
    expect(buildFeatureScopePrompt(['shop'])).toBe(
      'You work from the workspace root and may read all of it; you may change files only in this project folder: shop.',
    );
  });
});
