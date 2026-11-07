import { createContext, use, useEffect, useRef, type ReactNode } from 'react';

import { usePromptInput, type PromptInputState } from '../prompt-input/use-prompt-input.js';

import type { QuestionAnswer } from './question-card.js';


const AnswerInputContext = createContext<PromptInputState | null>(null);

/**
 * Holds what is being written to the open question above the feed, which unmounts the card when it scrolls away. Only
 * the card reads it, so typing does not render the rest of the feed.
 */
export function AnswerInputProvider({ conversationId, questionId, onAnswer, children }: {
  readonly conversationId: string;
  readonly questionId: string | undefined;
  readonly onAnswer: (answer: QuestionAnswer) => void;
  readonly children: ReactNode;
}) {
  const input = usePromptInput({
    conversationId,
    onSubmit: (text, attachments) => onAnswer({ kind: 'text', text, ...(attachments.length > 0 && { attachments: [...attachments] }) }),
  });
  const writtenFor = useRef(questionId);

  useEffect(() => {
    if (writtenFor.current !== questionId) {
      writtenFor.current = questionId;
      input.reset();
    }
  });

  return <AnswerInputContext value={input}>{children}</AnswerInputContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAnswerInput(): PromptInputState {
  const input = use(AnswerInputContext);
  if (!input) {
    throw new Error('useAnswerInput needs an AnswerInputProvider');
  }
  return input;
}
