import { Check, ChevronDown, Mic, Paperclip, Send, Trash2 } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Textarea } from '../ui/textarea.js';

import { AttachmentChip } from './attachment-chip.js';
import { FileMentionPopup } from './file-mention-popup.js';
import { DEFAULT_MICROPHONE_ID } from './use-microphones.js';
import type { PromptInputState } from './use-prompt-input.js';


const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The field to write to the agents, with attachments, voice, mentions and history. `block` has the tools around the
 * field; `inline` holds them inside one frame, to sit within a card.
 */
export function PromptInput({ input, layout = 'block', label, placeholder, submitLabel, actions }: {
  readonly input: PromptInputState;
  readonly layout?: 'block' | 'inline';
  readonly label: string;
  readonly placeholder: string;
  readonly submitLabel: string;
  /** Buttons shown before the submit button. */
  readonly actions?: ReactNode;
}) {
  const {
    attachments, recorder, microphones, mentions, disabled, registerField, text, setText, canSubmit, submit, onKeyDown, position, attachRecording,
  } = input;
  const pickerRef = useRef<HTMLInputElement>(null);
  const recording = recorder.status === 'recording';
  const inline = layout === 'inline';
  const toolClass = inline ? 'size-8' : undefined;

  const attach = (
    <IconButton variant="ghost" label="Attach" className={toolClass} disabled={disabled || recording} onClick={() => pickerRef.current?.click()}>
      <Paperclip />
    </IconButton>
  );

  const voice = recording
    ? (
      <>
        <IconButton variant="ghost" label="Discard recording" className={toolClass} onClick={recorder.cancel}>
          <Trash2 />
        </IconButton>
        <IconButton label="Attach recording" className={toolClass} onClick={() => void attachRecording()}>
          <Check />
        </IconButton>
      </>
    )
    : (
      <div className="flex items-center">
        <IconButton
          variant="ghost"
          label="Record audio"
          className={cn('rounded-r-none', toolClass)}
          disabled={disabled || recorder.status === 'starting'}
          onClick={() => void recorder.start(microphones.selectedId)}
        >
          <Mic />
        </IconButton>
        <DropdownMenu onOpenChange={open => open && void microphones.load()}>
          <DropdownMenuTrigger
            render={<IconButton variant="ghost" label="Choose microphone" className="h-8 w-5 rounded-l-none px-0" disabled={disabled} />}
          >
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64">
            <DropdownMenuGroup><DropdownMenuLabel>Microphone</DropdownMenuLabel></DropdownMenuGroup>
            <DropdownMenuRadioGroup value={microphones.selectedId} onValueChange={microphones.select}>
              <DropdownMenuRadioItem closeOnClick value={DEFAULT_MICROPHONE_ID}>System default</DropdownMenuRadioItem>
              {microphones.devices.map(device => (
                <DropdownMenuRadioItem key={device.id} closeOnClick value={device.id}>{device.label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

  const field = recording
    ? (
      <div
        role="status"
        aria-label="Recording"
        className={cn('flex min-w-0 flex-1 items-center gap-2 px-3 text-sm', inline ? 'h-8' : 'h-10 rounded-md border')}
      >
        <span className="size-2 animate-pulse rounded-full bg-destructive" />
        <span className="tabular-nums">{formatElapsed(recorder.elapsedSeconds)}</span>
      </div>
    )
    : (
      <Textarea
        ref={registerField}
        aria-autocomplete="list"
        aria-expanded={mentions.isOpen}
        aria-controls={mentions.isOpen ? mentions.listboxId : undefined}
        aria-activedescendant={mentions.isOpen ? mentions.optionId(mentions.highlightedIndex) : undefined}
        aria-label={label}
        placeholder={placeholder}
        rows={1}
        className={cn(
          'max-h-48 resize-none',
          inline ? 'min-h-8 min-w-0 flex-1 border-0 bg-transparent py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent' : 'min-h-10',
        )}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          mentions.trackCursor(event.currentTarget);
        }}
        {...mentions.fieldHandlers}
        onKeyDown={onKeyDown}
        onPaste={attachments.onPaste}
      />
    );

  const submitButton = (
    <IconButton label={submitLabel} className={toolClass} disabled={!canSubmit || recording} onClick={submit}>
      <Send />
    </IconButton>
  );

  return (
    <div
      {...(disabled ? {} : attachments.dropHandlers)}
      className={cn('relative flex w-full flex-col gap-2 rounded-lg', attachments.dragging && 'ring-2 ring-primary')}
    >
      {attachments.dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/90 text-sm text-primary">
          Drop files to attach them
        </div>
      )}
      {position && (
        <span className="absolute -top-5 left-2 text-xs text-muted-foreground">
          {`History ${position.position}/${position.total}`}
        </span>
      )}
      {recorder.error && (
        <p role="alert" className="text-xs text-destructive">{recorder.error}</p>
      )}
      {attachments.items.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-1">
          {attachments.items.map(item => (
            <AttachmentChip key={item.id} name={item.name} status={item.status} error={item.error} onRemove={() => attachments.remove(item.id)} />
          ))}
        </ul>
      )}
      <div
        className={cn(
          'relative flex items-end',
          inline ? 'gap-0.5 rounded-lg border border-input bg-background p-0.5 focus-within:ring-[3px] focus-within:ring-ring/50' : 'gap-2',
        )}
      >
        {mentions.isOpen && (
          <FileMentionPopup
            id={mentions.listboxId}
            items={mentions.items}
            isWalking={mentions.isWalking}
            highlightedIndex={mentions.highlightedIndex}
            optionId={mentions.optionId}
            onHighlightChange={mentions.onHighlightChange}
            onAccept={mentions.accept}
          />
        )}
        <input
          ref={pickerRef}
          type="file"
          multiple
          hidden
          aria-label="Attach files"
          onChange={(event) => {
            attachments.addFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        {inline
          ? (
            <>
              {field}
              {attach}
              {voice}
            </>
          )
          : (
            <>
              {attach}
              {voice}
              {field}
            </>
          )}
        {actions}
        {submitButton}
      </div>
    </div>
  );
}
