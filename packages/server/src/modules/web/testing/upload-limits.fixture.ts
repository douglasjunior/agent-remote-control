import type { SettingValues } from '@agent-remote-control/protocol/settings';

import { SettingsChangeNotifierService } from '../../settings/services/settings-change-notifier.service.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import { WebConnectionRegistryService } from '../services/web-connection-registry.service.js';
import { WebUploadLimitsService } from '../services/web-upload-limits.service.js';


/** The upload limits over stubbed settings, at their defaults unless the spec gives the values. */
export function createUploadLimits(values: Partial<SettingValues> = {}, registry = new WebConnectionRegistryService()) {
  const settings = new StubRuntimeSettings(values);
  const notifier = new SettingsChangeNotifierService();
  const limits = new WebUploadLimitsService(settings, notifier, registry);
  return { limits, settings, notifier, registry };
}
