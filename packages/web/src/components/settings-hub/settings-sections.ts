import type { SettingView } from '@agent-remote-control/protocol/settings';
import { BookOpenText, Bot, type LucideIcon, MessagesSquare, SlidersHorizontal, Users, Wrench } from 'lucide-react';


export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', description: 'How the agents talk to you.', icon: SlidersHorizontal },
  { id: 'agents', label: 'Agents', description: 'Log in to the agent CLIs and tune the login check.', icon: Bot },
  { id: 'squads', label: 'Squads', description: 'Who runs each role, set in one go.', icon: Users },
  { id: 'skills', label: 'Skills', description: 'What the agents read on demand.', icon: BookOpenText },
  { id: 'discord', label: 'Discord', description: 'The bot that brings the conversations to Discord.', icon: MessagesSquare },
  { id: 'advanced', label: 'Advanced', description: 'Origins, remote access, sessions, shell commands, retries and speech-to-text.', icon: Wrench },
] as const satisfies readonly { readonly id: string; readonly label: string; readonly description: string; readonly icon: LucideIcon }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** The sections whose content is the settings of the server. */
export type ServerSectionId = Exclude<SettingsSectionId, 'squads' | 'skills'>;

export const DEFAULT_SECTION: SettingsSectionId = 'general';

/** From this viewport width the hub shows its section list beside the section; below it, one at a time. */
export const HUB_WIDE_QUERY = '(min-width: 1024px)';

const KEY_SECTIONS: Readonly<Record<string, ServerSectionId>> = {
  USER_LANGUAGE: 'general',
};

const GROUP_SECTIONS: Readonly<Record<string, ServerSectionId>> = {
  discord: 'discord',
  agents: 'agents',
};

export function isSettingsSection(value: string | null): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some(section => section.id === value);
}

export function sectionById(id: SettingsSectionId) {
  return SETTINGS_SECTIONS.find(section => section.id === id)!;
}

/** The section a setting is edited in: by key, then by its group; a setting or a group this app does not know is advanced. */
export function sectionOf(view: SettingView): ServerSectionId {
  return KEY_SECTIONS[view.key] ?? GROUP_SECTIONS[view.group] ?? 'advanced';
}
