import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { createUploadLimits } from '../testing/upload-limits.fixture.js';


describe('WebUploadLimitsService', () => {
  const setup = () => {
    const fixture = createUploadLimits();
    const connection = new FakeClientConnection('c1');
    fixture.registry.register(connection);
    fixture.limits.onModuleInit();
    return { ...fixture, connection };
  };

  it('should read the limits from the settings as they are', () => {
    const { limits, settings } = setup();

    expect(limits.event()).toEqual({ type: 'upload.limits', maxBytes: 10 * 1024 * 1024, maxAttachments: 10 });

    settings.set('WEB_UPLOAD_MAX_MB', 50);
    settings.set('WEB_MAX_ATTACHMENTS', 3);

    expect(limits.event()).toEqual({ type: 'upload.limits', maxBytes: 50 * 1024 * 1024, maxAttachments: 3 });
  });

  it('should tell every connection the limits when a setting behind them changes, and stop once destroyed', async () => {
    const { limits, settings, notifier, connection } = setup();
    const changed = { type: 'upload.limits', maxBytes: 10 * 1024 * 1024, maxAttachments: 4 };

    notifier.notify(['LOG_RETENTION_DAYS']);
    settings.set('WEB_MAX_ATTACHMENTS', 4);
    notifier.notify(['WEB_MAX_ATTACHMENTS']);
    await rs.waitFor(() => expect(connection.sent).toEqual([changed]));
    limits.onModuleDestroy();
    notifier.notify(['WEB_UPLOAD_MAX_MB']);
    await Promise.resolve();

    expect(connection.sent).toEqual([changed]);
  });
});
