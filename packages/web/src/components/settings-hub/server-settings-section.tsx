import type { SettingView } from '@agent-remote-control/protocol/settings';

import { AgentLogins } from '../auth/agent-logins.js';
import { DiscordConnectionTest } from '../server-settings/discord-connection-test.js';
import { SettingField } from '../server-settings/setting-field.js';
import { groupTitle } from '../server-settings/setting-texts.js';

import { useServerSettings } from './server-settings-provider.js';
import { SettingsSectionHeader } from './settings-section-header.js';
import { type ServerSectionId, sectionById, sectionOf } from './settings-sections.js';


/** The groups in the order their first setting comes from the server. */
function groupsOf(views: readonly SettingView[]): [string, SettingView[]][] {
  const groups = new Map<string, SettingView[]>();
  for (const view of views) {
    groups.set(view.group, [...groups.get(view.group) ?? [], view]);
  }
  return [...groups];
}

/**
 * The settings of one section, by group: each field shows where its value comes from, and a setting that applies on
 * restart says so. The Agents section starts with the logins of the agent CLIs.
 */
export function ServerSettingsSection({ section }: { readonly section: ServerSectionId }) {
  const { views, drafts, checks, saving, saves, discordTest, draft, reset, testDiscord } = useServerSettings();
  const { label, description } = sectionById(section);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
        <SettingsSectionHeader title={label} description={description} />
        {section === 'agents' && <AgentLogins />}
        {views === null
          ? <p role="status" className="text-sm text-muted-foreground">Loading settings…</p>
          : groupsOf(views.filter(view => sectionOf(view) === section)).map(([group, members]) => (
            <section key={group} aria-labelledby={`settings-group-${group}`} className="flex flex-col gap-2">
              <h4 id={`settings-group-${group}`} className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {groupTitle(section, group)}
              </h4>
              <div className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
                {members.map((view) => {
                  const check = checks.get(view.key);
                  return (
                    <SettingField
                      key={view.kind === 'secret' ? `${view.key}:${saves}` : view.key}
                      view={view}
                      draft={drafts[view.key]}
                      error={check && !check.ok ? check.error : undefined}
                      disabled={saving}
                      onDraft={value => draft(view.key, value)}
                      onReset={() => reset(view.key)}
                    />
                  );
                })}
                {group === 'discord' && <DiscordConnectionTest state={discordTest} onTest={testDiscord} />}
              </div>
            </section>
          ))}
        <p className="px-1 text-xs text-muted-foreground">
          A value saved here takes the place of its environment variable; reset it to use the variable or the default again.
        </p>
      </div>
    </div>
  );
}
