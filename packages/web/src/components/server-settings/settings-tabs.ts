import type { SettingView } from '@agent-remote-control/protocol/settings';


export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'discord', label: 'Discord' },
  { id: 'agents', label: 'Agents' },
  { id: 'squads', label: 'Squads' },
  { id: 'advanced', label: 'Advanced' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'general';

/** The query parameter of the settings page that names the open tab; the default tab leaves the address bare. */
export const SETTINGS_TAB_PARAM = 'tab';

const KEY_TABS: Readonly<Record<string, SettingsTabId>> = {
  USER_LANGUAGE: 'general',
};

const GROUP_TABS: Readonly<Record<string, SettingsTabId>> = {
  discord: 'discord',
  agents: 'agents',
};

export function isSettingsTab(value: string | null): value is SettingsTabId {
  return SETTINGS_TABS.some(tab => tab.id === value);
}

/** The tab a setting is edited in: by key, then by its group; a setting or a group this app does not know is advanced. */
export function tabOf(view: SettingView): SettingsTabId {
  return KEY_TABS[view.key] ?? GROUP_TABS[view.group] ?? 'advanced';
}
