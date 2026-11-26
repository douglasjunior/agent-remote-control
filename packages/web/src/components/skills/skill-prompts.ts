/** The message that opens a conversation asking the CEO to change a skill; the user finishes it. */
export function changeSkillPrompt(name: string): string {
  return `Change the skill "${name}": `;
}

/** The message that opens a conversation asking the CEO for a new skill; the user finishes it. */
export const CREATE_SKILL_PROMPT = 'Create a skill that ';
