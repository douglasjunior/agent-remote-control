import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useConnection } from '../../connection/connection-context.js';

import { useFileMentions } from './use-file-mentions.js';
import { useMicrophones } from './use-microphones.js';
import { usePromptAttachments } from './use-prompt-attachments.js';
import { usePromptHistory } from './use-prompt-history.js';
import { useVoiceRecorder } from './use-voice-recorder.js';


export type PromptInputState = ReturnType<typeof usePromptInput>;

/**
 * Everything being written in a prompt: text, attachments, recording, mentions and history. It lives apart from
 * `PromptInput` so an owner that outlives the field keeps it, because the feed unmounts its off-screen rows and a
 * recording or an upload must survive that.
 */
export function usePromptInput({ conversationId, initialText = '', disabled = false, onSubmit }: {
  readonly conversationId: string;
  readonly initialText?: string;
  readonly disabled?: boolean;
  readonly onSubmit: (text: string, attachments: readonly Attachment[]) => void;
}) {
  const { connection } = useConnection();
  const [text, setText] = useState(initialText);
  const history = usePromptHistory(connection, setText);
  const attachments = usePromptAttachments(connection, conversationId);
  const recorder = useVoiceRecorder();
  const microphones = useMicrophones();
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const registerField = useCallback((field: HTMLTextAreaElement | null) => {
    fieldRef.current = field;
  }, []);
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

  useEffect(() => {
    if (initialText !== '') {
      fieldRef.current?.focus();
    }
  }, [initialText]);

  const trimmed = text.trim();
  const canSubmit = !disabled && !attachments.uploading && (trimmed !== '' || attachments.ready.length > 0);

  const clear = () => {
    history.reset();
    attachments.clear();
    setText('');
  };

  const submit = () => {
    if (canSubmit) {
      onSubmit(trimmed, attachments.ready);
      clear();
    }
  };

  const reset = () => {
    recorder.cancel();
    clear();
  };

  const attachRecording = async () => {
    const file = await recorder.finish();
    if (file) {
      attachments.addFiles([file]);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    mentions.onKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    history.onKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return {
    text,
    setText,
    disabled,
    canSubmit,
    submit,
    reset,
    attachRecording,
    onKeyDown,
    position: history.position,
    attachments,
    recorder,
    microphones,
    mentions,
    registerField,
  };
}
