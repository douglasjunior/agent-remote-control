import type { ReactNode } from 'react';

import { AnswerInputProvider } from '../components/entries/answer-input.js';
import { ConnectionProvider } from '../connection/connection-context.js';

import { FakeServerConnection } from './fake-server-connection.js';


/** What the feed expects around it, for specs that render it without the rest of the conversation view. */
export function FeedProviders({ children }: { readonly children: ReactNode }) {
  return (
    <ConnectionProvider connection={new FakeServerConnection()}>
      <AnswerInputProvider conversationId="c1" questionId={undefined} onAnswer={vi.fn()}>
        {children}
      </AnswerInputProvider>
    </ConnectionProvider>
  );
}
