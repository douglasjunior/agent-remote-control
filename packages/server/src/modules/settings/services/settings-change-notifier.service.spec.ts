import { Logger } from '@nestjs/common';

import { SettingsChangeNotifierService } from './settings-change-notifier.service.js';


describe('SettingsChangeNotifierService', () => {
  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should tell every listener the keys that changed until it stops listening', async () => {
    const notifier = new SettingsChangeNotifierService();
    const heard: string[][] = [];
    const stop = notifier.onChange(keys => void heard.push([...keys]));

    notifier.notify(['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']);
    await rs.waitFor(() => expect(heard).toEqual([['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']]));
    stop();
    notifier.notify(['REMOTE_URL']);
    await Promise.resolve();

    expect(heard).toHaveLength(1);
  });

  it('should log a listener that fails or rejects and still tell the others', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const notifier = new SettingsChangeNotifierService();
    const heard: string[] = [];
    notifier.onChange(() => {
      throw new Error('boom');
    });
    notifier.onChange(async () => Promise.reject('raw failure'));
    notifier.onChange(keys => void heard.push(...keys));

    notifier.notify(['REMOTE_URL']);

    await rs.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledWith('settings_listener_failed: boom');
    expect(error).toHaveBeenCalledWith('settings_listener_failed: raw failure');
    expect(heard).toEqual(['REMOTE_URL']);
  });
});
