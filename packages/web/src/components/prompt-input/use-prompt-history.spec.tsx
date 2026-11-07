import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { HISTORY_REQUEST_TIMEOUT_MS, usePromptHistory } from './use-prompt-history.js';


function Harness({ connection }: { readonly connection: FakeServerConnection }) {
  const [text, setText] = useState('');
  const { onKeyDown, reset, position } = usePromptHistory(connection, setText);
  return (
    <>
      <textarea aria-label="field" value={text} onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} />
      <button onClick={reset}>reset</button>
      <output>{position ? `${position.position}/${position.total}` : 'none'}</output>
    </>
  );
}

function setup() {
  const connection = new FakeServerConnection();
  render(<Harness connection={connection} />);
  const field = screen.getByLabelText<HTMLTextAreaElement>('field');
  const type = (value: string) => fireEvent.change(field, { target: { value } });
  const press = (key: string, init: object = {}) => fireEvent.keyDown(field, { key, ...init });
  const requestId = () => {
    const request = connection.sent.findLast(command => command.type === 'prompts.history');
    return request?.type === 'prompts.history' ? request.requestId : '';
  };
  const answer = async (prompts: string[]) => {
    await act(async () => connection.emitEvent({ type: 'prompts.list', requestId: requestId(), prompts }));
  };
  return { connection, field, type, press, answer, requestId };
}

describe('usePromptHistory', () => {
  afterEach(() => vi.useRealTimers());

  it('opens the history on the first ArrowUp and shows the most recent prompt', async () => {
    const { field, press, answer, connection } = setup();

    press('ArrowUp');
    await answer(['latest', 'older']);

    expect(connection.sent).toEqual([{ type: 'prompts.history', requestId: expect.any(String) }]);
    expect(field.value).toBe('latest');
    expect(screen.getByRole('status')).toHaveTextContent('2/2');
  });

  it('walks to the oldest entry and stops there', async () => {
    const { field, press, answer } = setup();

    press('ArrowUp');
    await answer(['latest', 'older']);
    press('ArrowUp');
    press('ArrowUp');

    expect(field.value).toBe('older');
    expect(screen.getByRole('status')).toHaveTextContent('1/2');
  });

  it('returns to the text being typed when going down past the most recent entry', async () => {
    const { field, type, press, answer } = setup();
    type('draft');

    press('ArrowUp');
    await answer(['latest']);
    press('ArrowDown');

    expect(field.value).toBe('draft');
    expect(screen.getByRole('status')).toHaveTextContent('none');
  });

  it('keeps the edit made at each position', async () => {
    const { field, type, press, answer } = setup();

    press('ArrowUp');
    await answer(['latest', 'older']);
    type('latest edited');
    press('ArrowUp');
    press('ArrowDown');

    expect(field.value).toBe('latest edited');
  });

  it('does nothing on ArrowDown outside a navigation session', () => {
    const { field, type, press } = setup();
    type('draft');

    press('ArrowDown');

    expect(field.value).toBe('draft');
  });

  it('does not open a session for an empty history, and the next ArrowUp asks again', async () => {
    const { press, answer, connection } = setup();

    press('ArrowUp');
    await answer([]);
    press('ArrowUp');

    expect(connection.sent).toHaveLength(2);
  });

  it('ignores ArrowUp while the history is loading', () => {
    const { press, connection } = setup();

    press('ArrowUp');
    press('ArrowUp');

    expect(connection.sent).toHaveLength(1);
  });

  it('ignores responses to other requests', async () => {
    const { field, press, connection } = setup();

    press('ArrowUp');
    await act(async () => connection.emitEvent({ type: 'prompts.list', requestId: 'other', prompts: ['x'] }));

    expect(field.value).toBe('');
  });

  it('gives up after the timeout and asks again on the next ArrowUp', async () => {
    vi.useFakeTimers();
    const { press, connection } = setup();

    press('ArrowUp');
    await act(async () => vi.advanceTimersByTimeAsync(HISTORY_REQUEST_TIMEOUT_MS));
    press('ArrowUp');

    expect(connection.sent).toHaveLength(2);
  });

  it('only navigates from the first line going up and the last line going down', async () => {
    const { field, type, press, answer, connection } = setup();
    type('one\ntwo');

    field.setSelectionRange(5, 5);
    press('ArrowUp');
    expect(connection.sent).toHaveLength(0);

    field.setSelectionRange(1, 1);
    press('ArrowUp');
    await answer(['latest']);
    expect(field.value).toBe('latest');

    type('one\ntwo');
    field.setSelectionRange(1, 1);
    press('ArrowDown');
    expect(field.value).toBe('one\ntwo');
  });

  it.each([
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['IME composition', { isComposing: true }],
  ])('ignores ArrowUp with %s', (_label, init) => {
    const { press, connection } = setup();

    press('ArrowUp', init);

    expect(connection.sent).toHaveLength(0);
  });

  it('ignores other keys', () => {
    const { press, connection } = setup();

    press('a');

    expect(connection.sent).toHaveLength(0);
  });

  it('reset ends the session so the next ArrowUp reads the history again', async () => {
    const { press, answer, connection } = setup();

    press('ArrowUp');
    await answer(['latest']);
    fireEvent.click(screen.getByText('reset'));
    press('ArrowUp');

    expect(connection.sent).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('none');
  });
});
