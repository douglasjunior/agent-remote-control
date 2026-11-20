import { SETTING_SCHEMAS, USER_LANGUAGE_KEY, type SettingView, userLanguageSchema } from '@agent-remote-control/protocol/settings';


/** What the user changed in a field: a switch's state, a field's text, or a secret's replacement (`''` clears it). */
export type SettingDraft = string | boolean;

type SettingValue = string | number | boolean;
type Checked = { readonly ok: true; readonly value: SettingValue } | { readonly ok: false; readonly error: string };
type Schema = { safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: { issues: readonly { message: string }[] } } };

const DIGITS = /^\d+$/;

/** The draft a field starts from: the value in use, as the field shows it. */
export function initialDraft(view: SettingView): SettingDraft {
  switch (view.kind) {
    case 'boolean':
      return view.value;
    case 'integer':
      return String(view.value);
    case 'secret':
      return '';
    default:
      return view.value;
  }
}

/** A secret is changed only by a draft; any other field when its draft differs from the value in use. */
export function isChanged(view: SettingView, draft: SettingDraft | undefined): boolean {
  if (draft === undefined) {
    return false;
  }
  return view.kind === 'secret' || draft !== initialDraft(view);
}

/** Checks a draft with the schema the server checks it with, giving the value to save or the message to show. */
export function checkDraft(view: SettingView, draft: SettingDraft): Checked {
  if (view.kind === 'integer') {
    const text = String(draft).trim();
    return DIGITS.test(text) ? checkValue(view.key, Number(text)) : { ok: false, error: 'Use a whole number' };
  }
  return checkValue(view.key, draft);
}

function checkValue(key: string, value: SettingValue): Checked {
  const schema: Schema | undefined = key === USER_LANGUAGE_KEY ? userLanguageSchema : (SETTING_SCHEMAS as Readonly<Record<string, Schema>>)[key];
  if (!schema) {
    return { ok: true, value };
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data as SettingValue } : { ok: false, error: parsed.error.issues[0]!.message };
}
