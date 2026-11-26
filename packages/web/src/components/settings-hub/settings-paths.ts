import type { Location } from 'react-router';

import type { ProfileDraft } from '../settings/profile-choice.js';


export const SETTINGS_PATH = '/settings';

/**
 * What the router state of a link into the settings hub carries: where closing the hub returns, and the profiles a
 * new squad starts from when it is saved from a conversation.
 */
export type SettingsState = {
  readonly returnTo?: string;
  readonly draft?: { readonly profiles: Readonly<Record<string, ProfileDraft>> };
};

export function settingsPath(section: string): string {
  return `${SETTINGS_PATH}/${section}`;
}

export const NEW_SQUAD_PATH = settingsPath('squads/new');

export function squadsPath(id?: string): string {
  return id ? settingsPath(`squads/${encodeURIComponent(id)}`) : settingsPath('squads');
}

export function skillsPath(name?: string): string {
  return name ? settingsPath(`skills/${encodeURIComponent(name)}`) : settingsPath('skills');
}

/** The state of a link into the hub: a link from another page remembers it, one within the hub keeps where to return. */
export function settingsState(location: Location): SettingsState | null {
  if (location.pathname === SETTINGS_PATH || location.pathname.startsWith(`${SETTINGS_PATH}/`)) {
    const returnTo = (location.state as SettingsState | null)?.returnTo;
    return returnTo ? { returnTo } : null;
  }
  return { returnTo: location.pathname + location.search };
}
