import type { SettingView } from '@agent-remote-control/protocol/settings';

import { formatInUnit, parseUnitText, timeUnitOf, toUnitText } from './setting-units.js';


const base = { group: 'general', apply: 'live', envOnly: false, source: 'default' } as const;
const integer = (key: string, defaultValue: number): SettingView => ({ ...base, key, kind: 'integer', value: defaultValue, defaultValue });

describe('setting units', () => {
  it('should pick seconds for a time whose default is under a minute and minutes for the others', () => {
    expect(timeUnitOf(integer('AGENT_AUTH_STATUS_TIMEOUT_MS', 10_000))?.name).toBe('seconds');
    expect(timeUnitOf(integer('TURN_RETRY_BASE_DELAY_MS', 59_999))?.name).toBe('seconds');
    expect(timeUnitOf(integer('SHELL_COMMAND_TIMEOUT_MS', 60_000))?.name).toBe('minutes');
    expect(timeUnitOf(integer('SESSION_IDLE_TIMEOUT_MS', 1_800_000))?.name).toBe('minutes');
  });

  it('should leave a setting that is not a time in milliseconds as it is', () => {
    expect(timeUnitOf(integer('LOG_RETENTION_DAYS', 14))).toBeUndefined();
    expect(timeUnitOf({ ...base, key: 'SOME_MS', kind: 'text', value: '', defaultValue: '' })).toBeUndefined();
  });

  it('should write milliseconds in a unit, keeping the decimals a whole millisecond needs', () => {
    const minutes = timeUnitOf(integer('QUESTION_TIMEOUT_MS', 300_000))!;
    const seconds = timeUnitOf(integer('AGENT_AUTH_STATUS_TIMEOUT_MS', 10_000))!;

    expect(toUnitText(300_000, minutes)).toBe('5');
    expect(toUnitText(90_000, minutes)).toBe('1.5');
    expect(toUnitText(1, minutes)).toBe('0.000017');
    expect(parseUnitText(toUnitText(1, minutes), minutes)).toBe(1);
    expect(toUnitText(2_500, seconds)).toBe('2.5');
    expect(toUnitText(0, seconds)).toBe('0');
  });

  it('should read a plain number, with decimals, as milliseconds and nothing else', () => {
    const minutes = timeUnitOf(integer('QUESTION_TIMEOUT_MS', 300_000))!;

    expect(parseUnitText(' 1.5 ', minutes)).toBe(90_000);
    expect(parseUnitText('.5', minutes)).toBe(30_000);
    expect(parseUnitText('2.', minutes)).toBe(120_000);
    expect(parseUnitText('1.1', minutes)).toBe(66_000);
    for (const text of ['', '.', '-1', '1,5', '1e3', 'soon', '1 2']) {
      expect(parseUnitText(text, minutes)).toBeNull();
    }
  });

  it('should name the unit with its singular for one', () => {
    const minutes = timeUnitOf(integer('QUESTION_TIMEOUT_MS', 300_000))!;
    const seconds = timeUnitOf(integer('AGENT_AUTH_STATUS_TIMEOUT_MS', 10_000))!;

    expect(formatInUnit(60_000, minutes)).toBe('1 minute');
    expect(formatInUnit(90_000, minutes)).toBe('1.5 minutes');
    expect(formatInUnit(0, minutes)).toBe('0 minutes');
    expect(formatInUnit(1_000, seconds)).toBe('1 second');
  });
});
