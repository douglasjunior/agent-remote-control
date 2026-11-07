import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionProvider } from '../../connection/connection-context.js';
import { FakeServerConnection } from '../../test/fake-server-connection.js';
import { PromptInput } from '../prompt-input/prompt-input.js';

import { AnswerInputProvider, useAnswerInput } from './answer-input.js';


function Field() {
  return <PromptInput input={useAnswerInput()} layout="inline" label="Your answer" placeholder="" submitLabel="Answer" />;
}

/** Mounts and unmounts the field as the virtualized feed does, and moves on to another question. */
function Harness({ onAnswer }: { readonly onAnswer: () => void }) {
  const [mounted, setMounted] = useState(true);
  const [question, setQuestion] = useState('q1');
  return (
    <AnswerInputProvider conversationId="c1" questionId={question} onAnswer={onAnswer}>
      <button type="button" onClick={() => setMounted(current => !current)}>Toggle</button>
      <button type="button" onClick={() => setQuestion('q2')}>Next question</button>
      {mounted && <Field />}
    </AnswerInputProvider>
  );
}

function setup() {
  const onAnswer = vi.fn();
  render(<ConnectionProvider connection={new FakeServerConnection()}><Harness onAnswer={onAnswer} /></ConnectionProvider>);
  return { onAnswer };
}

describe('AnswerInputProvider', () => {
  it('submits the text as an answer, without attachments when there are none', async () => {
    const { onAnswer } = setup();

    await userEvent.type(screen.getByLabelText('Your answer'), 'my own{Enter}');

    expect(onAnswer).toHaveBeenCalledWith({ kind: 'text', text: 'my own' });
    expect(screen.getByLabelText('Your answer')).toHaveValue('');
  });

  it('keeps what was written while the card is off screen', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Your answer'), 'half an answer');

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));

    expect(screen.getByLabelText('Your answer')).toHaveValue('half an answer');
  });

  it('forgets what was written when the question changes', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Your answer'), 'for the first');

    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));

    expect(screen.getByLabelText('Your answer')).toHaveValue('');
  });

  it('refuses a field outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Field />)).toThrow('useAnswerInput needs an AnswerInputProvider');
  });
});
