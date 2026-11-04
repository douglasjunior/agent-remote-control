import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { Check, ChevronDown, Mic, Paperclip, Send, Square, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useConnection } from '../connection/connection-context.js';
import { cn } from '../lib/utils.js';

import { IconButton } from './icon-button.js';
import { AttachmentChip } from './prompt-input/attachment-chip.js';
import { FileMentionPopup } from './prompt-input/file-mention-popup.js';
import { useFileMentions } from './prompt-input/use-file-mentions.js';
import { DEFAULT_MICROPHONE_ID, useMicrophones } from './prompt-input/use-microphones.js';
import { usePromptAttachments } from './prompt-input/use-prompt-attachments.js';
import { usePromptHistory } from './prompt-input/use-prompt-history.js';
import { useVoiceRecorder } from './prompt-input/use-voice-recorder.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from './ui/dropdown-menu.js';
import { Textarea } from './ui/textarea.js';


export function Composer({ conversationId, disabled, running, onSend, onStop }: {
  readonly conversationId: string;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onSend: (text: string, attachments: readonly Attachment[]) => void;
  readonly onStop: () => void;
}) {
  const { connection } = useConnection();
  const [text, setText] = useState('');
  const { onKeyDown: onHistoryKeyDown, reset: resetHistory, position } = usePromptHistory(connection, setText);
  const attachments = usePromptAttachments(connection, conversationId);
  const recorder = useVoiceRecorder();
  const microphones = useMicrophones();
  const recording = recorder.status === 'recording';
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentions = useFileMentions({
    connection,
    value: text,
    onValueChange: setText,
    placeCaret: (offset) => {
      pendingCaret.current = offset;
    },
  });

  // An accepted mention reaches the field on the next render; the caret goes after it.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) {
      return;
    }
    fieldRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const trimmed = text.trim();
  const canSend = !disabled && !attachments.uploading && (trimmed !== '' || attachments.ready.length > 0);

  const send = () => {
    if (!canSend) {
      return;
    }
    onSend(trimmed, attachments.ready);
    resetHistory();
    attachments.clear();
    setText('');
  };

  const attachRecording = async () => {
    const file = await recorder.finish();
    if (file) {
      attachments.addFiles([file]);
    }
  };

  const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    mentions.onKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    onHistoryKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t p-3">
      <div
        {...(disabled ? {} : attachments.dropHandlers)}
        className={cn('relative mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-lg', attachments.dragging && 'ring-2 ring-primary')}
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
        <div className="relative flex items-end gap-2">
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
          <IconButton variant="ghost" label="Attach" disabled={disabled || recording} onClick={() => pickerRef.current?.click()}>
            <Paperclip />
          </IconButton>
          {recording
            ? (
              <>
                <IconButton variant="ghost" label="Discard recording" onClick={recorder.cancel}>
                  <Trash2 />
                </IconButton>
                <IconButton label="Attach recording" onClick={() => void attachRecording()}>
                  <Check />
                </IconButton>
                <div role="status" aria-label="Recording" className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm">
                  <span className="size-2 animate-pulse rounded-full bg-destructive" />
                  <span className="tabular-nums">{formatElapsed(recorder.elapsedSeconds)}</span>
                </div>
              </>
            )
            : (
              <>
                <div className="flex items-center">
                  <IconButton
                    variant="ghost"
                    label="Record audio"
                    className="rounded-r-none"
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
                <Textarea
                  ref={fieldRef}
                  aria-autocomplete="list"
                  aria-expanded={mentions.isOpen}
                  aria-controls={mentions.isOpen ? mentions.listboxId : undefined}
                  aria-activedescendant={mentions.isOpen ? mentions.optionId(mentions.highlightedIndex) : undefined}
                  aria-label="Message"
                  placeholder="Message the agents…"
                  rows={1}
                  className="max-h-48 min-h-10 resize-none"
                  value={text}
                  disabled={disabled}
                  onChange={(event) => {
                    setText(event.target.value);
                    mentions.trackCursor(event.currentTarget);
                  }}
                  {...mentions.fieldHandlers}
                  onKeyDown={handleKeyDown}
                  onPaste={attachments.onPaste}
                />
              </>
            )}
          {running && (
            <IconButton variant="outline" label="Stop" onClick={onStop}>
              <Square />
            </IconButton>
          )}
          <IconButton label="Send" disabled={!canSend || recording} onClick={send}>
            <Send />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
