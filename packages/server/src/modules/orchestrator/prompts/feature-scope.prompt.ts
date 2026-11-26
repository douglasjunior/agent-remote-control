/** Where the agent of a feature works: from the workspaces root, which it reads, changing files only in the feature's projects. */
export function buildFeatureScopePrompt(projectNames: readonly string[]): string {
  return `You work from the workspace root and may read all of it; you may change files only in ${projectNames.length === 1 ? 'this project folder' : 'these project folders'}: ${projectNames.join(', ')}.`;
}
