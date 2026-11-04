import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtuosoMockContext } from 'react-virtuoso';

import { AT, userEntry } from '../../test/render-app.js';

import { FeedList } from './feed-list.js';


type ObserverRecord = { callback: () => void; targets: Element[] };

function stubResizeObserver() {
  const records: ObserverRecord[] = [];
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: ObserverRecord;
    constructor(callback: () => void) {
      this.record = { callback, targets: [] };
      records.push(this.record);
    }

    observe(target: Element) { this.record.targets.push(target); }
    unobserve = vi.fn();
    disconnect() { this.record.targets = []; }
  });
  return (content: Element | null) => act(() => {
    for (const record of records) {
      if (content && record.targets.includes(content)) {
        record.callback();
      }
    }
  });
}

function setMetrics(element: HTMLElement, metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(element, key, { configurable: true, writable: true, value });
  }
}

function scrollTo(element: HTMLElement, top: number) {
  element.scrollTop = top;
  fireEvent.scroll(element);
}

const toolEntry = (id: string): ConversationEntry => ({ id, at: AT, type: 'tool', title: `tool ${id}`, status: 'completed' });

function renderFeed(entries: ConversationEntry[], draft = '') {
  const tree = (list: ConversationEntry[], text: string) => (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 100_000, itemHeight: 100 }}>
      <FeedList entries={list} draft={text} running={false} onAnswer={vi.fn()} />
    </VirtuosoMockContext.Provider>
  );
  const view = render(tree(entries, draft));
  return { ...view, update: (list: ConversationEntry[], text = '') => view.rerender(tree(list, text)) };
}

describe('FeedList', () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;
  let trigger: ReturnType<typeof stubResizeObserver>;
  const growContent = () => trigger(viewport().firstElementChild);

  beforeEach(() => {
    trigger = stubResizeObserver();
    scrollSpy = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function viewport() {
    return screen.getByTestId('message-viewport');
  }

  it('renders the entries and the streaming draft', () => {
    renderFeed([userEntry('a', 'hello')], 'streaming answer');

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('streaming answer')).toBeInTheDocument();
  });

  it('follows the content while the reader stays at the end', () => {
    renderFeed([userEntry('a')]);
    setMetrics(viewport(), { scrollHeight: 1400, scrollTop: 1000, clientHeight: 400 });

    growContent();

    expect(scrollSpy).toHaveBeenCalledWith({ top: 1400, behavior: 'auto' });
  });

  it('stops following after the reader scrolls up and resumes near the end', () => {
    renderFeed([userEntry('a')]);
    const element = viewport();
    setMetrics(element, { scrollHeight: 2000, scrollTop: 1600, clientHeight: 400 });
    scrollTo(element, 1600);
    scrollTo(element, 200);
    scrollSpy.mockClear();

    growContent();
    expect(scrollSpy).not.toHaveBeenCalled();

    scrollTo(element, 1590);
    growContent();
    expect(scrollSpy).toHaveBeenCalledWith({ top: 2000, behavior: 'auto' });
  });

  it('shows the scroll-to-bottom button only away from the end and scrolls smoothly on click', async () => {
    const user = userEvent.setup();
    renderFeed([userEntry('a')]);
    const element = viewport();
    setMetrics(element, { scrollHeight: 2000, scrollTop: 1600, clientHeight: 400 });
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();

    scrollTo(element, 1600);
    scrollTo(element, 200);
    const button = screen.getByRole('button', { name: 'Scroll to bottom' });
    scrollSpy.mockClear();
    await user.click(button);

    expect(scrollSpy).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();
  });

  it('resumes following when the user sends a new message', () => {
    const { update } = renderFeed([userEntry('a')]);
    const element = viewport();
    setMetrics(element, { scrollHeight: 2000, scrollTop: 1600, clientHeight: 400 });
    scrollTo(element, 1600);
    scrollTo(element, 200);
    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument();
    scrollSpy.mockClear();

    update([userEntry('a'), userEntry('b')]);

    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();
    expect(scrollSpy).toHaveBeenCalledWith({ top: 2000, behavior: 'auto' });
  });

  it('keeps an activity group open after it is expanded', async () => {
    const user = userEvent.setup();
    const { update } = renderFeed([toolEntry('t1')]);

    await user.click(screen.getByRole('button', { name: /Show details/ }));
    expect(screen.getByText('tool t1')).toBeInTheDocument();

    update([toolEntry('t1'), userEntry('u1')]);
    expect(screen.getByText('tool t1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show details/ }));
    expect(screen.queryByText('tool t1')).not.toBeInTheDocument();
  });
});
