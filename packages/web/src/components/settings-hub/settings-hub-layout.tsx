import { ArrowLeft, RotateCw, X } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useMatch, useNavigate } from 'react-router';

import { useMediaQuery } from '../../lib/use-media-query.js';
import { IconButton } from '../icon-button.js';
import { settingText } from '../server-settings/setting-texts.js';

import { ServerSettingsProvider, useServerSettings } from './server-settings-provider.js';
import { SettingsNav } from './settings-nav.js';
import { SETTINGS_PATH, type SettingsState, settingsPath, settingsState } from './settings-paths.js';
import { SettingsSaveBar } from './settings-save-bar.js';
import { DEFAULT_SECTION, HUB_WIDE_QUERY, isSettingsSection } from './settings-sections.js';


/** The `/settings?tab=<section>` addresses name the section to open in this query parameter. */
const LEGACY_SECTION_PARAM = 'tab';

function HubFrame() {
  const { marks, restartKeys } = useServerSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useMediaQuery(HUB_WIDE_QUERY);
  const atList = useMatch({ path: SETTINGS_PATH, end: true }) !== null;
  const atSection = useMatch(`${SETTINGS_PATH}/:section`) !== null;
  const legacySection = new URLSearchParams(location.search).get(LEGACY_SECTION_PARAM);

  if (atList && (legacySection !== null || wide)) {
    const section = isSettingsSection(legacySection) ? legacySection : DEFAULT_SECTION;
    return <Navigate to={settingsPath(section)} replace state={location.state} />;
  }

  const close = () => void navigate((location.state as SettingsState | null)?.returnTo ?? '/');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h2 className="font-heading text-lg font-semibold">Settings</h2>
        <IconButton variant="ghost" size="icon-sm" label="Close settings" onClick={close}>
          <X />
        </IconButton>
      </header>
      <div className={wide ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 flex-col'}>
        {(wide || atList) && <SettingsNav wide={wide} marks={marks} />}
        {(wide || !atList) && (
          <div className="@container/hub flex min-h-0 min-w-0 flex-1 flex-col">
            {!wide && atSection && (
              <Link to={SETTINGS_PATH} state={settingsState(location)} className="inline-flex w-fit items-center gap-1.5 px-4 pt-4 text-sm text-muted-foreground hover:text-foreground sm:px-6">
                <ArrowLeft aria-hidden className="size-4" />
                Back
              </Link>
            )}
            {restartKeys.length > 0 && (
              <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
                <p role="status" className="flex items-start gap-2 rounded-xl border border-attention bg-[color-mix(in_oklab,var(--attention)_9%,var(--card))] px-3 py-2.5 text-sm">
                  <RotateCw aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {`Restart the server to apply ${restartKeys.map(key => settingText(key).label).join(', ')}.`}
                </p>
              </div>
            )}
            <Outlet />
          </div>
        )}
      </div>
      <SettingsSaveBar />
    </div>
  );
}

/**
 * The one place of the configuration: a section list and the section picked from it, which the route names. Beside
 * each other on a wide screen; on a phone `/settings` is the list and each section opens on its own with a Back. The
 * drafts of the server settings live here, above the sections.
 */
export function SettingsHubLayout() {
  return (
    <ServerSettingsProvider>
      <HubFrame />
    </ServerSettingsProvider>
  );
}
