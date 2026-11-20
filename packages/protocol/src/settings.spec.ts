import { describe, expect, it } from '@rstest/core';

import { SETTING_SCHEMAS, settingViewSchema, userLanguageSchema } from './settings.js';


describe('settings', () => {
  it.each([
    ['DISCORD_GUILD_ID', '', ''],
    ['DISCORD_GUILD_ID', ' 12345678901234567 ', '12345678901234567'],
    ['WEB_ALLOWED_ORIGINS', 'http://localhost:5173, https://arc.example.com/', 'http://localhost:5173, https://arc.example.com/'],
    ['WEB_ALLOWED_ORIGINS', '', ''],
    ['REMOTE_URL', 'https://arc.example.com', 'https://arc.example.com'],
    ['REMOTE_URL', '', ''],
    ['STT_LANGUAGE', 'auto', 'auto'],
    ['STT_MODEL', 'large-v3-turbo-q5_0', 'large-v3-turbo-q5_0'],
    ['QUESTION_TIMEOUT_MS', 0, 0],
  ] as const)('should accept %s = %j', (key, value, parsed) => {
    expect(SETTING_SCHEMAS[key].parse(value)).toEqual(parsed);
  });

  it.each([
    ['DISCORD_GUILD_ID', 'home', 'A server ID is a number of 17 to 20 digits'],
    ['WEB_ALLOWED_ORIGINS', 'localhost:5173', 'List origins such as https://arc.example.com, separated by commas'],
    ['WEB_ALLOWED_ORIGINS', 'https://arc.example.com/app', 'List origins such as https://arc.example.com, separated by commas'],
    ['WEB_ALLOWED_ORIGINS', 'http://', 'List origins such as https://arc.example.com, separated by commas'],
    ['REMOTE_URL', 'http://arc.example.com', 'Use the HTTPS URL of a signaling server (HTTP only for localhost)'],
    ['STT_LANGUAGE', 'portuguese', 'Use auto or a two-letter language code such as en'],
    ['STT_WHISPER_BIN', ' ', 'Name the executable or its path'],
    ['SESSION_IDLE_TIMEOUT_MS', 0, 'Use a number above 0'],
    ['QUESTION_TIMEOUT_MS', -1, 'Use 0 or more'],
    ['QUESTION_TIMEOUT_MS', 1.5, 'Use a whole number'],
  ] as const)('should refuse %s = %j with a message for the user', (key, value, message) => {
    expect(SETTING_SCHEMAS[key].safeParse(value).error?.issues[0]?.message).toBe(message);
  });

  it('should normalize a language name and refuse one that could break a prompt', () => {
    expect(userLanguageSchema.parse('  Brazilian   Portuguese ')).toBe('Brazilian Portuguese');
    expect(userLanguageSchema.safeParse(' ').error?.issues[0]?.message).toBe('Name a language');
    expect(userLanguageSchema.safeParse('x'.repeat(65)).error?.issues[0]?.message).toBe('A language name is shorter');
    expect(userLanguageSchema.safeParse('<script>').error?.issues[0]?.message).toBe('Leave out < > [ ] and backticks');
  });

  it('should show a secret only as whether it holds a value', () => {
    const secret = { key: 'DISCORD_BOT_TOKEN', group: 'discord', apply: 'live', envOnly: false, source: 'saved', kind: 'secret' };

    expect(settingViewSchema.parse({ ...secret, value: { set: true } })).toEqual({ ...secret, value: { set: true } });
    expect(settingViewSchema.safeParse({ ...secret, value: 'token' }).success).toBe(false);
  });
});
