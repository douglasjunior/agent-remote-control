import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import type { ListRange, VirtuosoHandle } from 'react-virtuoso';

import { FeedProviders } from '../../test/feed-providers.js';
import { AT, userEntry } from '../../test/render-app.js';

import { FeedList, type FeedHandle } from './feed-list.js';


const virtuoso = rs.hoisted(() => ({ range: { startIndex: 0, endIndex: 2 }, scrollToIndex: rs.fn() }));

// The real list measures its items, which jsdom cannot do: this stand-in renders only the items of a visible range,
// reports it, and moves it to the requested index on `scrollToIndex`. Like the real list, it reports indexes offset by
// `firstItemIndex` and scrolls to an index of `data`.
rs.mock('react-virtuoso', () => ({
  Virtuoso: ({ ref, data, itemContent, context, rangeChanged, firstItemIndex = 0 }: {
    ref: Ref<Pick<VirtuosoHandle, 'scrollToIndex'>>;
    data: readonly unknown[];
    itemContent: (index: number, item: unknown, context: unknown) => ReactNode;
    context: unknown;
    rangeChanged: (range: ListRange) => void;
    firstItemIndex?: number;
  }) => {
    const [range, setRange] = useState(virtuoso.range);
    useImperativeHandle(ref, () => ({
      scrollToIndex: (location) => {
        virtuoso.scrollToIndex(location);
        const index = (location as { index: number }).index;
        setRange({ startIndex: index, endIndex: index + 1 });
      },
    }));
    useEffect(() => rangeChanged({ startIndex: range.startIndex + firstItemIndex, endIndex: range.endIndex + firstItemIndex }), [rangeChanged, range, firstItemIndex]);
    return <div>{data.map((item, index) => (index >= range.startIndex && index <= range.endIndex ? <div key={index}>{itemContent(index + firstItemIndex, item, context)}</div> : null))}</div>;
  },
}));

const question: ConversationEntry = {
  id: 'q1', at: AT, type: 'question', askerRole: 'TECH_LEAD', askerRoleName: 'Tech Lead', text: 'Which branch?', options: ['main', 'dev'], number: 1, total: 1, closed: false,
};
const reply: ConversationEntry = { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'Merge requests are open' };
const entries = [userEntry('u1'), question, userEntry('u2'), userEntry('u3'), userEntry('u4'), reply];

function feed(list: ConversationEntry[], handle: Ref<FeedHandle> = createRef<FeedHandle>()) {
  return <FeedList ref={handle} team={[]} entries={list} draft="" running focus={null} onFocus={rs.fn()} onHover={rs.fn()} onAnswer={rs.fn()} onRetryNow={rs.fn()} onStopRetrying={rs.fn()} />;
}

function renderFeed(list: ConversationEntry[] = entries, handle: Ref<FeedHandle> = createRef<FeedHandle>()) {
  return render(feed(list, handle), { wrapper: FeedProviders });
}

describe('FeedList open question out of view', () => {
  beforeEach(() => {
    virtuoso.range = { startIndex: 3, endIndex: 5 };
    virtuoso.scrollToIndex.mockClear();
  });

  it('should show the waiting line and scroll to the question card from its button', async () => {
    const user = userEvent.setup();
    renderFeed();

    expect(screen.getByText('Tech Lead is waiting for your answer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to question' }));

    expect(virtuoso.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
    expect(screen.getByRole('button', { name: 'main' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Go to question' })).not.toBeInTheDocument();
  });

  it('should follow the question across earlier entries put before it', async () => {
    const user = userEvent.setup();
    virtuoso.range = { startIndex: 0, endIndex: 1 };
    const { rerender } = renderFeed();
    expect(screen.queryByText('Tech Lead is waiting for your answer')).not.toBeInTheDocument();

    rerender(feed([userEntry('e1'), userEntry('e2'), ...entries]));
    expect(screen.getByText('Tech Lead is waiting for your answer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to question' }));
    expect(virtuoso.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 3 }));
  });

  it('should hide the line when the question is within the visible range, and when it is closed', () => {
    virtuoso.range = { startIndex: 0, endIndex: 2 };
    const { unmount } = renderFeed();
    expect(screen.queryByText('Tech Lead is waiting for your answer')).not.toBeInTheDocument();
    unmount();

    virtuoso.range = { startIndex: 3, endIndex: 5 };
    renderFeed([userEntry('u1'), { ...question, closed: true }, reply]);
    expect(screen.queryByText('Tech Lead is waiting for your answer')).not.toBeInTheDocument();
  });

  it('should not snap back to the end when the content grows after scrolling up to the question', async () => {
    const user = userEvent.setup();
    let grow: () => void = rs.fn();
    rs.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        grow = callback;
      }

      observe = rs.fn();
      unobserve = rs.fn();
      disconnect = rs.fn();
    });
    const scrollTo = rs.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => undefined);
    renderFeed();
    const viewport = screen.getByTestId('message-viewport');
    for (const [key, value] of Object.entries({ scrollHeight: 2000, scrollTop: 1700, clientHeight: 400 })) {
      Object.defineProperty(viewport, key, { configurable: true, writable: true, value });
    }
    fireEvent.scroll(viewport);

    await user.click(screen.getByRole('button', { name: 'Go to question' }));
    scrollTo.mockClear();
    act(() => grow());

    expect(scrollTo).not.toHaveBeenCalled();
    rs.unstubAllGlobals();
    scrollTo.mockRestore();
  });
});
