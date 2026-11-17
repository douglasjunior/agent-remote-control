import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useRef, useState } from 'react';

import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { useFileMentions } from './use-file-mentions.js';


function Harness({ connection }: { readonly connection: FakeServerConnection }) {
  const [text, setText] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentions = useFileMentions({
    connection,
    value: text,
    onValueChange: setText,
    placeCaret: (offset) => {
      pendingCaret.current = offset;
    },
  });
  useLayoutEffect(() => {
    if (pendingCaret.current !== null) {
      fieldRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
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

async function setup() {
  const user = userEvent.setup();
  const connection = new FakeServerConnection();
  render(<Harness connection={connection} />);
  const field = screen.getByLabelText<HTMLTextAreaElement>('field');
  await user.click(field);
  const type = async (text: string) => {
    if (text !== '') {
      await user.keyboard(text.replaceAll('\n', '{Enter}'));
    }
  };
  const press = (keys: string) => user.keyboard(keys);
  const moveCaret = (offset: number) => user.pointer({ target: field, offset, keys: '[MouseLeft]' });
  const searches = () => connection.sent.filter(command => command.type === 'files.search');
  const closes = () => connection.sent.filter(command => command.type === 'files.close');
  const answer = (items = results, walking = false) => {
    const last = searches().at(-1);
    act(() => connection.emitEvent({ type: 'files.results', requestId: last?.type === 'files.search' ? last.requestId : '', items, walking }));
  };
  const state = () => screen.getByLabelText('state').textContent;
  /** Waits out the typing pause until the search for `query` goes out. */
  const searched = (query: string) => waitFor(() => expect(searches().at(-1)).toMatchObject({ query }));
  return { user, connection, field, type, press, moveCaret, searches, closes, answer, state, searched };
}

describe('useFileMentions', () => {
  it('should search on a bare @ without waiting and open the list with the results', async () => {
    const { type, searches, answer, state } = await setup();

    await type('@');
    answer();

    expect(searches()).toEqual([{ type: 'files.search', requestId: expect.any(String), query: '' }]);
    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('should keep one request id while the list stays open and only changes the query', async () => {
    const { type, searches, searched } = await setup();

    await type('@ap');
    await searched('ap');

    const ids = searches().map(command => (command.type === 'files.search' ? command.requestId : ''));
    expect(searches()).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it('should close the server search when the list is dismissed', async () => {
    const { type, press, searches, closes, answer } = await setup();
    await type('@');
    answer();

    await press('{Escape}');
    const id = searches()[0].type === 'files.search' ? searches()[0].requestId : '';

    expect(closes()).toEqual([{ type: 'files.close', requestId: id }]);
  });

  it('should report that the server is still walking until the last batch', async () => {
    const { type, answer } = await setup();
    await type('@');

    answer(results, true);
    expect(screen.getByLabelText('walking')).toHaveTextContent('true');

    answer(results, false);
    expect(screen.getByLabelText('walking')).toHaveTextContent('false');
  });

  it('should open a new search without the results of the closed one', async () => {
    const { type, answer, press, searches, state } = await setup();
    await type('@');
    answer();
    await press('{Escape}');

    await press('{Backspace}');
    await type('@');

    expect(searches()).toHaveLength(2);
    expect(state()).toBe('closed');
  });

  it('should start at the first item again when the searched query changes', async () => {
    const { type, answer, press, state, searched } = await setup();
    await type('@');
    answer();
    await press('{ArrowDown}');
    expect(state()).toBe('open:1:app/,a.ts');

    await type('a');
    await searched('a');

    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('should keep the highlight while more results stream in for the same query', async () => {
    const { type, answer, press, state } = await setup();
    await type('@');
    answer();
    await press('{ArrowDown}');

    answer([...results, { path: 'b.ts', kind: 'file', matches: [] }], true);

    expect(state()).toBe('open:1:app/,a.ts,b.ts');
  });

  it('should wait for a pause in typing before searching for a query', async () => {
    const { type, searches, answer, searched } = await setup();
    await type('@');
    answer();

    await type('ap');
    expect(searches()).toHaveLength(1);
    await searched('ap');

    expect(searches()).toHaveLength(2);
  });

  it('should ignore a response to an earlier request', async () => {
    const { type, connection, state } = await setup();
    await type('@');

    act(() => connection.emitEvent({ type: 'files.results', requestId: 'stale', items: results, walking: false }));

    expect(state()).toBe('closed');
  });

  it('should stay closed without results, without an @ and without focus', async () => {
    const { user, field, type, answer, state } = await setup();

    await type('plain');
    expect(state()).toBe('closed');

    await user.clear(field);
    await type('@');
    answer([]);
    expect(state()).toBe('closed');

    answer();
    await user.click(document.body);
    expect(state()).toBe('closed');
  });

  it('should move the highlight with the arrows and stop at the ends', async () => {
    const { type, answer, press, state } = await setup();
    await type('@');
    answer();

    await press('{ArrowDown}{ArrowDown}');
    expect(state()).toBe('open:1:app/,a.ts');
    await press('{ArrowUp}{ArrowUp}');
    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('should accept the highlighted file with Enter, add a space and move the caret after it', async () => {
    const { type, answer, press, field } = await setup();
    await type('see @');
    answer();
    await press('{ArrowDown}');

    await press('{Enter}');

    expect(field.value).toBe('see @a.ts ');
    expect(field.selectionStart).toBe('see @a.ts '.length);
  });

  it('should accept a directory with Tab and leave the list open for the next level', async () => {
    const { type, answer, press, field, state, searched } = await setup();
    await type('@');
    answer();

    await press('{Tab}');

    expect(field.value).toBe('@app/');
    expect(field).toHaveFocus();
    await searched('app/');
    answer([{ path: 'app/main.ts', kind: 'file', matches: [] }]);
    expect(state()).toBe('open:0:app/main.ts');
  });

  it('should dismiss the list with Esc until the mention ends', async () => {
    const { type, answer, press, state } = await setup();
    await type('@');
    answer();

    await press('{Escape}');
    expect(state()).toBe('closed');

    await press('{Backspace}');
    await type('@');
    answer();
    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('should stay closed after Esc while the caret moves inside the same mention', async () => {
    const { type, answer, press, moveCaret, state } = await setup();
    await type('@ab');
    answer();

    await press('{Escape}');
    await moveCaret(2);

    expect(state()).toBe('closed');
  });

  it.each([
    ['shift', '{Shift>}{ArrowDown}{/Shift}'],
    ['ctrl', '{Control>}{ArrowDown}{/Control}'],
  ])('should leave the arrows alone with %s', async (_label, keys) => {
    const { type, answer, press, state } = await setup();
    await type('@');
    answer();

    await press(keys);

    expect(state()).toBe('open:0:app/,a.ts');
  });

  it('should leave the keys it does not handle to the field', async () => {
    const { type, answer, press, field, state } = await setup();
    await type('@');
    answer();

    await press('{Home}');

    expect(field.selectionStart).toBe(0);
    expect(state()).toBe('closed');
  });

  describe('the mention under the caret', () => {
    it('should read the query between the @ and the caret and replace the whole token when accepting', async () => {
      const { type, moveCaret, answer, press, field, searched } = await setup();
      await type('see @app/src now');
      await moveCaret(8);
      await searched('app');

      answer();
      await press('{ArrowDown}{Enter}');
      expect(field.value).toBe('see @a.ts  now');
    });

    it.each([
      ['after whitespace', 'a b @c'],
      ['after a line break', 'a\n@b'],
    ])('should find the @ %s', async (_label, text) => {
      const { type, searched } = await setup();

      await type(text);

      await searched(text.at(-1)!);
    });

    it.each([
      ['an @ inside a word', 'mail@host', 9],
      ['no @', 'plain text', 5],
      ['whitespace between the @ and the caret', '@a b', 4],
      ['the caret before the @', 'x @a', 1],
      ['an empty text', '', 0],
    ])('should have no mention to search for with %s', async (_label, text, caret) => {
      const { type, moveCaret, searches, closes, state } = await setup();

      await type(text);
      await moveCaret(caret);

      expect(state()).toBe('closed');
      expect(closes()).toHaveLength(searches().length);
    });

    it('should quote the path of a file that has whitespace', async () => {
      const { type, answer, field, press } = await setup();
      await type('@');
      answer([{ path: 'my app/a b.ts', kind: 'file', matches: [] }]);

      await press('{Enter}');

      expect(field.value).toBe('@"my app/a b.ts" ');
    });
  });
});
