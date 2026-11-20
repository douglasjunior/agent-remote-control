import { USER_LANGUAGE_KEY, type SettingSource, type SettingView } from '@agent-remote-control/protocol/settings';
import { CircleHelp, RotateCw } from 'lucide-react';
import { useState } from 'react';

import { formatDuration } from '../../lib/format.js';
import { ChoiceSelect } from '../artifacts/choice-select.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Switch } from '../ui/switch.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';

import { initialDraft, isChanged, type SettingDraft } from './setting-drafts.js';
import { settingText, type SettingText } from './setting-texts.js';


const SOURCES: Readonly<Record<SettingSource, { readonly label: string; readonly variant: 'default' | 'secondary' | 'outline' }>> = {
  saved: { label: 'Saved', variant: 'default' },
  env: { label: 'Environment', variant: 'secondary' },
  default: { label: 'Default', variant: 'outline' },
};
const DIGITS = /^\d+$/;

type FieldProps = {
  readonly view: SettingView;
  /** The user's change, `undefined` while the field shows the value in use. */
  readonly draft: SettingDraft | undefined;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly onDraft: (draft: SettingDraft | undefined) => void;
  readonly onReset: () => void;
};

/**
 * One setting: its value, where the value comes from, how it applies and the message of a value that does not check. A
 * setting only its environment variable sets shows its value read-only, without a change or a reset.
 */
export function SettingField({ view, draft, error, disabled, onDraft, onReset }: FieldProps) {
  const text = settingText(view.key);
  const id = `setting-${view.key}`;
  const labelId = `${id}-label`;
  const describedBy = [`${id}-description`, error && `${id}-error`].filter(Boolean).join(' ');

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <label id={labelId} htmlFor={id} className="text-sm font-medium">{text.label}</label>
          {view.envOnly && <EnvOnlyHint name={view.env ?? view.key} />}
          <Badge variant={SOURCES[view.source].variant}>{SOURCES[view.source].label}</Badge>
          {isChanged(view, draft) && <Badge variant="outline" className="border-attention text-foreground">Unsaved</Badge>}
        </div>
        {view.key !== USER_LANGUAGE_KEY && <code className="font-mono text-[11px] break-all text-muted-foreground">{view.key}</code>}
        <p id={`${id}-description`} className="text-[13px] leading-snug text-muted-foreground">{text.description}</p>
        {view.apply === 'restart' && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RotateCw aria-hidden className="size-3" />
            Applies when the server restarts.
          </p>
        )}
      </div>
      <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-72 sm:shrink-0">
        {view.envOnly
          ? <ReadOnlyValue id={id} describedBy={describedBy} view={view} />
          : <FieldControl id={id} labelId={labelId} describedBy={describedBy} view={view} text={text} draft={draft} invalid={Boolean(error)} disabled={disabled} onDraft={onDraft} />}
        {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
        {view.source === 'saved' && !view.envOnly && (
          <Button variant="link" size="sm" className="h-auto self-end p-0 text-xs" disabled={disabled} onClick={onReset}>
            Reset to default
          </Button>
        )}
      </div>
    </div>
  );
}

/** The question mark beside the label of a setting that only its environment variable sets; the tooltip names the variable. */
function EnvOnlyHint({ name }: { readonly name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label="Where this value is set" className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" />}
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>
        This value can only be set with the environment variable
        {' '}
        <code className="font-mono">{name}</code>
        .
      </TooltipContent>
    </Tooltip>
  );
}

function readOnlyText(view: SettingView): string {
  switch (view.kind) {
    case 'boolean':
      return view.value ? 'Enabled' : 'Disabled';
    case 'secret':
      return view.value.set ? 'Set' : 'Not set';
    case 'integer':
      return String(view.value);
    default:
      return view.value === '' ? 'Not set' : view.value;
  }
}

function ReadOnlyValue({ id, describedBy, view }: { readonly id: string; readonly describedBy: string; readonly view: SettingView }) {
  return (
    <output id={id} aria-describedby={describedBy} className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
      {readOnlyText(view)}
    </output>
  );
}

function FieldControl({ id, labelId, describedBy, view, text, draft, invalid, disabled, onDraft }: {
  readonly id: string;
  readonly labelId: string;
  readonly describedBy: string;
  readonly view: SettingView;
  readonly text: SettingText;
  readonly draft: SettingDraft | undefined;
  readonly invalid: boolean;
  readonly disabled?: boolean;
  readonly onDraft: (draft: SettingDraft | undefined) => void;
}) {
  const shown = draft ?? initialDraft(view);
  switch (view.kind) {
    case 'boolean':
      return (
        <Switch
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          className="self-end"
          checked={shown as boolean}
          disabled={disabled}
          onCheckedChange={checked => onDraft(checked)}
        />
      );
    case 'choice':
      return <ChoiceSelect label={text.label} value={shown as string} choices={view.options.map(option => ({ value: option, label: option }))} disabled={disabled} onChange={onDraft} />;
    case 'secret':
      return <SecretControl id={id} labelId={labelId} describedBy={describedBy} set={view.value.set} draft={draft as string | undefined} invalid={invalid} disabled={disabled} onDraft={onDraft} />;
    default:
      return (
        <div className="flex flex-col gap-1">
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            inputMode={view.kind === 'integer' ? 'numeric' : undefined}
            spellCheck={false}
            value={shown as string}
            disabled={disabled}
            onChange={event => onDraft(event.target.value)}
          />
          {text.unit && <UnitHint unit={text.unit} text={shown as string} />}
        </div>
      );
  }
}

function UnitHint({ unit, text }: { readonly unit: NonNullable<SettingText['unit']>; readonly text: string }) {
  const value = text.trim();
  if (unit !== 'ms' || !DIGITS.test(value)) {
    return <span className="text-right text-xs text-muted-foreground">{unit === 'ms' ? 'milliseconds' : unit}</span>;
  }
  const duration = Number(value) === 0 ? 'off' : formatDuration(Number(value));
  return <span className="text-right text-xs text-muted-foreground">{`milliseconds · ${duration}`}</span>;
}

/** Write-only: it says whether a value is saved, and takes a new one or clears it, never showing the one saved. */
function SecretControl({ id, labelId, describedBy, set, draft, invalid, disabled, onDraft }: {
  readonly id: string;
  readonly labelId: string;
  readonly describedBy: string;
  readonly set: boolean;
  readonly draft: string | undefined;
  readonly invalid: boolean;
  readonly disabled?: boolean;
  readonly onDraft: (draft: SettingDraft | undefined) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  if (draft === '' && !replacing) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">Cleared when you save</span>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onDraft(undefined)}>Undo</Button>
      </div>
    );
  }
  if (replacing || draft) {
    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          placeholder="Paste the new value"
          value={draft ?? ''}
          disabled={disabled}
          onChange={event => onDraft(event.target.value || undefined)}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setReplacing(false);
            onDraft(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <Badge id={id} variant={set ? 'secondary' : 'outline'}>{set ? 'Set' : 'Not set'}</Badge>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setReplacing(true)}>{set ? 'Replace' : 'Set'}</Button>
        {set && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onDraft('')}>Clear</Button>}
      </div>
    </div>
  );
}
