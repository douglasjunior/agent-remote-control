import type { SettingView } from '@agent-remote-control/protocol/settings';

import { checkDraft, initialDraft, isChanged } from './setting-drafts.js';


const base = { group: 'general', apply: 'live', envOnly: false, source: 'default' } as const;
const integer: SettingView = { ...base, key: 'LOG_RETENTION_DAYS', kind: 'integer', value: 14, defaultValue: 14 };
const minutes: SettingView = { ...base, key: 'QUESTION_TIMEOUT_MS', kind: 'integer', value: 300_000, defaultValue: 300_000 };
const seconds: SettingView = { ...base, key: 'AGENT_AUTH_STATUS_TIMEOUT_MS', kind: 'integer', value: 2_500, defaultValue: 10_000 };
const secret: SettingView = { ...base, key: 'DISCORD_BOT_TOKEN', kind: 'secret', value: { set: true } };
const unknown: SettingView = { ...base, key: 'NEW_SETTING', kind: 'text', value: 'a', defaultValue: 'a' };

describe('setting drafts', () => {
  it('should start each field from the value in use, and a secret empty', () => {
    expect(initialDraft(integer)).toBe('14');
    expect(initialDraft(minutes)).toBe('5');
    expect(initialDraft(seconds)).toBe('2.5');
    expect(initialDraft(secret)).toBe('');
    expect(initialDraft(unknown)).toBe('a');
  });

  it('should count a draft as a change when it differs, and any draft of a secret', () => {
    expect(isChanged(integer, undefined)).toBe(false);
    expect(isChanged(integer, '14')).toBe(false);
    expect(isChanged(integer, '1')).toBe(true);
    expect(isChanged(minutes, ' 5.0 ')).toBe(false);
    expect(isChanged(minutes, '5.5')).toBe(true);
    expect(isChanged(minutes, 'soon')).toBe(true);
    expect(isChanged(secret, '')).toBe(true);
  });

  it('should check a time in its unit and give it in milliseconds', () => {
    expect(checkDraft(minutes, '1.5')).toEqual({ ok: true, value: 90_000 });
    expect(checkDraft(minutes, '0')).toEqual({ ok: true, value: 0 });
    expect(checkDraft(seconds, ' 2.5 ')).toEqual({ ok: true, value: 2_500 });
    expect(checkDraft(seconds, '0')).toEqual({ ok: false, error: 'Use a number above 0' });
    expect(checkDraft(seconds, '1e3')).toEqual({ ok: false, error: 'Use a number of seconds, such as 1.5' });
    expect(checkDraft(minutes, '-1')).toEqual({ ok: false, error: 'Use a number of minutes, such as 1.5' });
    expect(checkDraft(minutes, '1'.repeat(20))).toEqual({ ok: false, error: 'That is more minutes than can be saved' });
  });

  it('should check a draft with the schema of its setting, accepting anything for a setting it does not know', () => {
    expect(checkDraft(integer, ' 15 ')).toEqual({ ok: true, value: 15 });
    expect(checkDraft(integer, '1.5')).toEqual({ ok: false, error: 'Use a whole number' });
    expect(checkDraft(unknown, 'b')).toEqual({ ok: true, value: 'b' });
  });
});
