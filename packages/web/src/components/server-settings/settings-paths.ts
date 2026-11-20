import type { Location } from 'react-router';


export const SETTINGS_PATH = '/settings';

/** Where closing the settings page returns: the page the user opened it from, carried in the router state. */
export type SettingsState = { readonly returnTo?: string };

export function settingsState(location: Location): SettingsState | null {
  return location.pathname === SETTINGS_PATH ? location.state as SettingsState | null : { returnTo: location.pathname };
}
