import { Logger } from '@nestjs/common';

import { RuntimeSettingsService } from '../services/runtime-settings.service.js';
import { SettingsChangeNotifierService } from '../services/settings-change-notifier.service.js';
import { FakeSettingsStore } from '../testing/fake-settings-store.js';

import { ChangeSettingsUseCase, type SettingsChange } from './change-settings.use-case.js';


describe('ChangeSettingsUseCase', () => {
  let store: FakeSettingsStore;
  let runtime: RuntimeSettingsService;
  let notified: string[][];
  let useCase: ChangeSettingsUseCase;
  let log: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    store = new FakeSettingsStore();
    runtime = new RuntimeSettingsService();
    const notifier = new SettingsChangeNotifierService();
    notified = [];
    notifier.onChange(keys => void notified.push([...keys]));
    useCase = new ChangeSettingsUseCase(store, runtime, notifier);
  });

  afterEach(() => {
    rs.unstubAllEnvs();
    rs.restoreAllMocks();
  });

  it('should save the parsed values, apply them at once and tell which changed, never logging a value', async () => {
    await expect(useCase.execute({ values: { DISCORD_BOT_TOKEN: '  secret-token ', QUESTION_TIMEOUT_MS: 0 } })).resolves.toEqual({ ok: true });

    expect(store.saved).toEqual({ DISCORD_BOT_TOKEN: 'secret-token', QUESTION_TIMEOUT_MS: 0 });
    expect(runtime.get('DISCORD_BOT_TOKEN')).toBe('secret-token');
    await rs.waitFor(() => expect(notified).toEqual([['DISCORD_BOT_TOKEN', 'QUESTION_TIMEOUT_MS']]));
    expect(log).toHaveBeenCalledWith('[Settings Changed] DISCORD_BOT_TOKEN, QUESTION_TIMEOUT_MS');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
  });

  it('should reset a setting to its variable, and tell only the settings whose value changed', async () => {
    rs.stubEnv('QUESTION_TIMEOUT_MS', '1500');
    await useCase.execute({ values: { QUESTION_TIMEOUT_MS: 1500, LOG_RETENTION_DAYS: 7 } });
    await rs.waitFor(() => expect(notified).toEqual([['LOG_RETENTION_DAYS']]));

    await expect(useCase.execute({ reset: ['QUESTION_TIMEOUT_MS', 'LOG_RETENTION_DAYS'] })).resolves.toEqual({ ok: true });

    expect(store.saved).toEqual({});
    expect(runtime.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 1500, source: 'env' });
    await rs.waitFor(() => expect(notified).toEqual([['LOG_RETENTION_DAYS'], ['LOG_RETENTION_DAYS']]));
  });

  it('should tell nothing when no value changed', async () => {
    await useCase.execute({ values: { QUESTION_TIMEOUT_MS: 300_000 } });
    await Promise.resolve();

    expect(notified).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    [{ values: { PORT: 3000 } }, 'Unknown setting: PORT'],
    [{ reset: ['toString'] }, 'Unknown setting: toString'],
    [{ values: { QUESTION_TIMEOUT_MS: 5 }, reset: ['QUESTION_TIMEOUT_MS'] }, 'QUESTION_TIMEOUT_MS cannot be changed and reset at once'],
    [{ values: { QUESTION_TIMEOUT_MS: -1 } }, 'QUESTION_TIMEOUT_MS: Use 0 or more'],
    [{ values: { REMOTE_URL: 'http://arc.example.com' } }, 'REMOTE_URL: Use the HTTPS URL of a signaling server (HTTP only for localhost)'],
  ])('should refuse %j whole, saving nothing', async (change: SettingsChange, error) => {
    await expect(useCase.execute({ ...change, values: { LOG_RETENTION_DAYS: 7, ...change.values } })).resolves.toEqual({ ok: false, error });

    expect(store.saved).toEqual({});
  });

  it('should reject when the store fails, applying nothing', async () => {
    store.failNextSave = true;

    await expect(useCase.execute({ values: { QUESTION_TIMEOUT_MS: 0 } })).rejects.toThrow('disk full');

    expect(runtime.get('QUESTION_TIMEOUT_MS')).toBe(300_000);
  });
});
