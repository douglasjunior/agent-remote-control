import type { SettingKey } from '@agent-remote-control/protocol/settings';
import { Injectable, Logger } from '@nestjs/common';

import type { ISettingsChangeNotifierPort, SettingsChangeListener } from '../ports/settings-change-notifier.port.js';


/** A listener that fails is logged, and the others still hear of the change. */
@Injectable()
export class SettingsChangeNotifierService implements ISettingsChangeNotifierPort {
  private readonly logger = new Logger(SettingsChangeNotifierService.name);
  private readonly listeners = new Set<SettingsChangeListener>();

  onChange(listener: SettingsChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(keys: readonly SettingKey[]): void {
    for (const listener of this.listeners) {
      void Promise.resolve()
        .then(() => listener(keys))
        .catch((error: unknown) => this.logger.error(`settings_listener_failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}
