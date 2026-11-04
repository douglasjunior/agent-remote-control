import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';

import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { MENTION_DEBOUNCE_MS, useFileMentions } from './use-file-mentions.js';


function Harness({ connection }: { readonly connection: FakeServerConnection }) {
  const [text, setText] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useFileMentions({
    connection,
    value: text,
    onValueChange: setText,
    placeCaret: offset => fieldRef.current?.setSelectionRange(offset, offset),
  });
  return (
    <>
      <textarea
        ref={fieldRef}
        aria-label="field"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          mentions.trackCursor(event.currentTarget);
        }}
        onKeyDown={mentions.onKeyDown}
        {...mentions.fieldHandlers}
      />
      <output aria-label="state">{mentions.isOpen ? `open:${mentions.highlightedIndex}:${mentions.items.map(item => item.path).join(',')}` : 'closed'}</output>
      <output aria-label="walking">{String(mentions.isWalking)}</output>
    </>
  );
}

const results = [{ path: 'app/', kind: 'directory' as const, matches: [] }, { path: 'a.ts', kind: 'file' as const, matches: [] }];

function setup() {
  const connection = new FakeServerConnection();
  render(<Harness connection={connection} />);
  const field = screen.getByLabelText<HTMLTextAreaElement>('field');
  const type = (value: string) => {
    fireEvent.change(field, { target: { value } });
    field.setSelectionRange(value.length, value.length);
  };
  const searches = () => connection.sent.filter(command => command.type === 'files.search');
  const closes = () => connection.sent.filter(command => command.type === 'files.close');
  const answer = (items = results, walking = false) => {
    const last = searches().at(-1);
    act(() => connection.emitEvent({ type: 'files.results', requestId: last?.type === 'files.search' ? last.requestId : '', items, walking }));
  };
  const state = () => screen.getByLabelText('state').textContent;
  const press = (key: string, init: object = {}) => fireEvent.keyDown(field, { key, ...init });
  fireEvent.focus(field);
  return { connection, field, type, searches, closes, answer, state, press };
}

describe('useFileMentions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('searches on a bare @ without waiting and opens the list with the results', () => {
    const { type, searches, answer, state } = setup();

    type('@');
    answer();

    expect(searches()).toEqual([{ type: 'files.search', requestId: expect.any(String), query: '' }]);
    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('keeps one request id while the list stays open and only changes the query', () => {
    const { type, searches } = setup();

    type('@');
    type('@ap');
    act(() => vi.advanceTimersByTime(MENTION_DEBOUNCE_MS));

    const ids = searches().map(command => (command.type === 'files.search' ? command.requestId : ''));
    expect(new Set(ids).size).toBe(1);
  });

  it('closes the server search when the list is dismissed and when the @ goes away', () => {
    const { type, press, searches, closes, answer } = setup();
    type('@');
    answer();

    press('Escape');
    const id = searches()[0].type === 'files.search' ? searches()[0].requestId : '';

    expect(closes()).toEqual([{ type: 'files.close', requestId: id }]);
  });

  it('reports that the server is still walking until the last batch', () => {
    const { type, answer } = setup();
    type('@');

    answer(results, true);
    expect(screen.getByLabelText('walking')).toHaveTextContent('true');

    answer(results, false);
    expect(screen.getByLabelText('walking')).toHaveTextContent('false');
  });

  it('clears the results when the search closes', () => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();
    press('Escape');

    type('@');

    expect(state()).toBe('closed');
  });

  it('starts at the first item again when the searched query changes', () => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();
    press('ArrowDown');
    expect(state()).toBe('open:1:app/,a.ts');

    type('@a');
    act(() => vi.advanceTimersByTime(MENTION_DEBOUNCE_MS));

    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('keeps the highlight while more results stream in for the same query', () => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();
    press('ArrowDown');

    answer([...results, { path: 'b.ts', kind: 'file', matches: [] }], true);

    expect(state()).toBe('open:1:app/,a.ts,b.ts');
  });

  it('waits for a pause in typing before searching for a query', () => {
    const { type, searches, answer } = setup();
    type('@');
    answer();

    type('@ap');
    expect(searches()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(MENTION_DEBOUNCE_MS));

    expect(searches().at(-1)).toMatchObject({ query: 'ap' });
  });

  it('ignores a response to an earlier request', () => {
    const { type, connection, state } = setup();
    type('@');

    act(() => connection.emitEvent({ type: 'files.results', requestId: 'stale', items: results, walking: false }));

    expect(state()).toBe('closed');
  });

  it('stays closed without results, without an @ and without focus', () => {
    const { type, answer, state, field } = setup();

    type('plain');
    expect(state()).toBe('closed');

    type('@');
    answer([]);
    expect(state()).toBe('closed');

    answer();
    fireEvent.blur(field);
    expect(state()).toBe('closed');
  });

  it('moves the highlight with the arrows and stops at the ends', () => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();

    press('ArrowDown');
    press('ArrowDown');
    expect(state()).toBe('open:1:app/,a.ts');
    press('ArrowUp');
    press('ArrowUp');
    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('accepts the highlighted file with Enter, adds a space and moves the caret after it', () => {
    const { type, answer, press, field } = setup();
    type('see @');
    answer();
    press('ArrowDown');

    press('Enter');

    expect(field.value).toBe('see @a.ts ');
    expect(field.selectionStart).toBe('see @a.ts '.length);
  });

  it('accepts a directory with Tab and leaves the list open for the next level', () => {
    const { type, answer, press, field, searches, state } = setup();
    type('@');
    answer();

    press('Tab');

    expect(field.value).toBe('@app/');
    act(() => vi.advanceTimersByTime(MENTION_DEBOUNCE_MS));
    expect(searches().at(-1)).toMatchObject({ query: 'app/' });
    answer([{ path: 'app/main.ts', kind: 'file', matches: [] }]);
    expect(state()).toBe('open:0:app/main.ts');
  });

  it('dismisses the list with Esc until the mention ends', () => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();

    press('Escape');
    expect(state()).toBe('closed');

    type('');
    type('@');
    answer();
    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('stays closed after Esc while the caret moves inside the same mention', () => {
    const { type, answer, press, field, state } = setup();
    type('@ab');
    answer();

    press('Escape');
    field.setSelectionRange(2, 2);
    fireEvent.select(field);

    expect(state()).toBe('closed');
  });

  it.each([
    ['shift', { shiftKey: true }],
    ['ctrl', { ctrlKey: true }],
  ])('leaves the arrows alone with %s', (_label, init) => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();

    press('ArrowDown', init);

    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('leaves other keys alone', () => {
    const { type, answer, press, state } = setup();
    type('@');
    answer();

    press('a');

    expect(state()).toBe('open:0:app/,a.ts');
  });
});
