import { SETTING_SCHEMAS } from '@agent-remote-control/protocol/settings';

import { SETTING_KEYS, SETTINGS_CATALOG } from './settings-catalog.constant.js';


describe('SETTINGS_CATALOG', () => {
  it('should define every setting of the protocol, overriding the variable of its name', () => {
    expect(SETTING_KEYS).toEqual(Object.keys(SETTING_SCHEMAS));
    for (const key of SETTING_KEYS) {
      expect(SETTINGS_CATALOG[key]).toMatchObject({ key, env: key, schema: SETTING_SCHEMAS[key] });
    }
  });

  it.each(SETTING_KEYS)('should give %s a default its own schema accepts', (key) => {
    const { schema, defaultValue } = SETTINGS_CATALOG[key];

    expect(schema.parse(defaultValue)).toEqual(defaultValue);
  });

  it('should apply every setting live except the speech-to-text provider', () => {
    expect(SETTING_KEYS.filter(key => SETTINGS_CATALOG[key].apply === 'restart')).toEqual(['STT_PROVIDER']);
    expect(SETTINGS_CATALOG.STT_PROVIDER.options).toEqual(['whisper-cpp', 'none']);
  });

  it('should leave only the environment to set what widens exposure or names a program to run', () => {
    expect(SETTING_KEYS.filter(key => SETTINGS_CATALOG[key].envOnly)).toEqual([
      'WEB_ALLOWED_ORIGINS',
      'REMOTE_URL',
      'SHELL_COMMAND_ENABLED',
      'STT_WHISPER_BIN',
      'STT_FFMPEG_BIN',
    ]);
  });
});
