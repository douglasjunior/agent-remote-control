import type { SettingView } from '@agent-remote-control/protocol/settings';

import { checkDraft, initialDraft, isChanged } from './setting-drafts.js';


const base = { group: 'general', apply: 'live', envOnly: false, source: 'default' } as const;
const integer: SettingView = { ...base, key: 'QUESTION_TIMEOUT_MS', kind: 'integer', value: 300_000, defaultValue: 300_000 };
const secret: SettingView = { ...base, key: 'DISCORD_BOT_TOKEN', kind: 'secret', value: { set: true } };
const unknown: SettingView = { ...base, key: 'NEW_SETTING', kind: 'text', value: 'a', defaultValue: 'a' };

describe('setting drafts', () => {
  it('should start each field from the value in use, and a secret empty', () => {
    expect(initialDraft(integer)).toBe('300000');
    expect(initialDraft(secret)).toBe('');
    expect(initialDraft(unknown)).toBe('a');
  });

  it('should count a draft as a change when it differs, and any draft of a secret', () => {
    expect(isChanged(integer, undefined)).toBe(false);
    expect(isChanged(integer, '300000')).toBe(false);
    expect(isChanged(integer, '1')).toBe(true);
    expect(isChanged(secret, '')).toBe(true);
  });

  it('should check a draft with the schema of its setting, accepting anything for a setting it does not know', () => {
    expect(checkDraft(integer, ' 15 ')).toEqual({ ok: true, value: 15 });
    expect(checkDraft(integer, '1.5')).toEqual({ ok: false, error: 'Use a whole number' });
    expect(checkDraft(unknown, 'b')).toEqual({ ok: true, value: 'b' });
  });
});
