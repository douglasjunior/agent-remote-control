import { describe, expect, it } from '@rstest/core';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ConnectionProvider } from '../connection/connection-context.js';
import { FakeServerConnection } from '../test/fake-server-connection.js';

import { emptyConversationView, type ConversationView } from './conversations-reducer.js';
import { useEarlierEntries } from './use-earlier-entries.js';


const view: ConversationView = { ...emptyConversationView, loaded: true, start: 40 };

function mount() {
  const connection = new FakeServerConnection();
  const wrapper = ({ children }: { readonly children: ReactNode }) => <ConnectionProvider connection={connection}>{children}</ConnectionProvider>;
  const hook = renderHook(() => useEarlierEntries('c1', view), { wrapper });
  act(() => connection.emitStatus('open'));
  const requests = () => connection.sent.filter(command => command.type === 'conversation.entries');
  return { connection, hook, requests };
}

describe('useEarlierEntries', () => {
  it('should ask once for a position however many times load runs before the next render', () => {
    const { hook, requests } = mount();
    const { load } = hook.result.current;

    act(() => {
      load();
      load();
    });
    act(() => load());

    expect(requests()).toEqual([{ type: 'conversation.entries', conversationId: 'c1', before: 40 }]);
    expect(hook.result.current.loading).toBe(true);
  });

  it('should ask again with a load kept from before the connection dropped, once it is back', () => {
    const { connection, hook, requests } = mount();
    const { load } = hook.result.current;
    act(() => load());

    act(() => connection.emitStatus('closed'));
    act(() => load());
    expect(requests()).toHaveLength(1);
    expect(hook.result.current.loading).toBe(false);

    act(() => connection.emitStatus('open'));
    act(() => {
      load();
      hook.result.current.load();
    });

    expect(requests()).toHaveLength(2);
  });
});
