export function skillsPath(name?: string): string {
  return name ? `/skills/${encodeURIComponent(name)}` : '/skills';
}

/** The message that opens a conversation asking the Coordinator to change a skill; the user finishes it. */
export function changeSkillPrompt(name: string): string {
  return `Change the skill "${name}": `;
}
