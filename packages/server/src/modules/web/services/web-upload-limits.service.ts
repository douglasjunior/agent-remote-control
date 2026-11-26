import { BYTES_PER_MB } from '@agent-remote-control/protocol/limits';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import type { SettingKey } from '@agent-remote-control/protocol/settings';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';
import { ISettingsChangeNotifierPort } from '../../settings/ports/settings-change-notifier.port.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


type UploadLimitsEvent = Extract<ServerEvent, { type: 'upload.limits' }>;

const LIMIT_KEYS: readonly SettingKey[] = ['WEB_UPLOAD_MAX_MB', 'WEB_MAX_ATTACHMENTS'];

/** What a web connection may attach, from the settings; every connection learns of a change, so the composer checks a file before uploading it. */
@Injectable()
export class WebUploadLimitsService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    @Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort,
    @Inject(ISettingsChangeNotifierPort) private readonly settingsChanges: ISettingsChangeNotifierPort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.settingsChanges.onChange((keys) => {
      if (keys.some(key => LIMIT_KEYS.includes(key))) {
        this.registry.broadcast(this.event());
      }
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  get maxMegabytes(): number {
    return this.settings.get('WEB_UPLOAD_MAX_MB');
  }

  get maxAttachments(): number {
    return this.settings.get('WEB_MAX_ATTACHMENTS');
  }

  event(): UploadLimitsEvent {
    return { type: 'upload.limits', maxBytes: this.maxMegabytes * BYTES_PER_MB, maxAttachments: this.maxAttachments };
  }
}
