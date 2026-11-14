import type { Location } from 'react-router';


/** Where closing the skills page returns: the page the user opened it from, carried in the router state. */
export type SkillsState = { readonly returnTo?: string };

export function skillsPath(name?: string): string {
  return name ? `/skills/${encodeURIComponent(name)}` : '/skills';
}

/** The state of a link into the skills page: a link from another page remembers it, one within the page keeps it. */
export function skillsState(location: Location): SkillsState | null {
  return location.pathname.startsWith(skillsPath())
    ? location.state as SkillsState | null
    : { returnTo: location.pathname };
}

/** The message that opens a conversation asking the Coordinator to change a skill; the user finishes it. */
export function changeSkillPrompt(name: string): string {
  return `Change the skill "${name}": `;
}
