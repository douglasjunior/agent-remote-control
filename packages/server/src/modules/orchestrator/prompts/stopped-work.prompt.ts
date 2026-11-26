import { formatWordList } from '../utils/word-list.util.js';


/**
 * The result of an agent the user stopped by ending the work on its artifact. The agent leaves its projects as it
 * left them when it stopped, so the CEO tells the user, who decides what to keep.
 */
export function buildStoppedWorkPrompt(artifactId: string, status: string, projectNames: readonly string[]): string {
  const projects = `${projectNames.length === 1 ? 'project' : 'projects'} ${formatWordList(projectNames.map(name => `"${name}"`))}`;
  return `The user moved ${artifactId} to ${status} on the board, which stopped this agent before it finished. What it changed in ${projects} before stopping stays there as it left it, possibly half done: tell the user, so they decide whether to keep or discard it.`;
}
