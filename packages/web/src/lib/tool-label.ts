import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


const LABELS: readonly (readonly [RegExp, string])[] = [
  [/\b(test|tests|vitest|jest|pytest|spec)\b/i, 'Running tests'],
  [/\b(git|commit|push|pull|rebase|merge|checkout|branch)\b/i, 'Working with Git'],
  [/\b(grep|search|find|glob|ls|list|tree)\b/i, 'Searching the project'],
  [/\b(edit|write|patch|apply|create|update|replace|rewrite)\b/i, 'Editing code'],
  [/\b(read|cat|view|open|head|tail)\b/i, 'Reading files'],
  [/\b(install|build|lint|compile|tsc|pnpm|npm|yarn|make)\b/i, 'Running project commands'],
  [/\b(fetch|curl|http|web)\b/i, 'Looking something up online'],
  [/\b(bash|shell|run|exec|command)\b/i, 'Running a command'],
];

/** What a tool call means in plain words; the title itself when nothing matches. */
export function toolLabel(title: string): string {
  return LABELS.find(([pattern]) => pattern.test(title))?.[1] ?? title;
}

/** What reading or writing a skill means in plain words. */
export function skillLabel(action: 'read' | 'write'): string {
  return action === 'read' ? 'Reading a skill' : 'Writing a skill';
}

/** What a step of an agent says it is doing, in plain words. */
export function stepLabel(step: Extract<ConversationEntry, { type: 'thought' | 'tool' | 'skill' }>): string {
  if (step.type === 'tool') {
    return toolLabel(step.title);
  }
  return step.type === 'skill' ? skillLabel(step.action) : 'Thinking';
}
