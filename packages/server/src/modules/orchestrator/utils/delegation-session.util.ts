/** A delegation with an artifact that asks for a new session leaves the session its role keeps for that task and starts another. */
export function startsNewTaskSession({ artifactId, sessionMode }: { readonly artifactId?: string; readonly sessionMode?: 'resume' | 'new' }): boolean {
  return artifactId !== undefined && sessionMode === 'new';
}
