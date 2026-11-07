import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, fireEvent, render as renderTree, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ReactElement } from 'react';
import { VirtuosoMockContext } from 'react-virtuoso';

import { FeedProviders } from '../../test/feed-providers.js';
import { AT, userEntry } from '../../test/render-app.js';

import { FeedList, type FeedHandle } from './feed-list.js';


const render = (tree: ReactElement) => renderTree(tree, { wrapper: FeedProviders });

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

const toolEntry = (id: string): ConversationEntry => ({ id, at: AT, type: 'tool', role: 'CEO', title: `tool ${id}`, status: 'completed' });

function renderFeed(entries: ConversationEntry[], draft = '', focus: string | null = null) {
  const tree = (list: ConversationEntry[], text: string) => (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 100_000, itemHeight: 100 }}>
      <FeedList team={[]} entries={list} draft={text} running={false} focus={focus} onFocus={vi.fn()} onHover={vi.fn()} onAnswer={vi.fn()} />
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

  it('dims the items of other agents when the feed is focused, and never the user or notices', () => {
    renderFeed([
      userEntry('u1', 'hello'),
      { id: 'n1', at: AT, type: 'notice', level: 'info', text: 'a notice' },
      { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'from the coordinator' },
      { id: 'x1', at: AT, type: 'tool', role: 'DEVELOPER', title: 'Run tests', status: 'completed' },
      { id: 'd1', at: AT, type: 'delegation', delegationId: '1:GIT_OPS', phase: 'started', round: 1, role: 'GIT_OPS', roleName: 'Git Ops', prompt: 'Do the work', summary: 'Open the PR' },
      { id: 'd2', at: AT, type: 'delegation', delegationId: '1:DEVELOPER', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer', prompt: 'Do the work', summary: 'Build it' },
    ], '', 'DEVELOPER');

    const dimmed = (text: string) => screen.getByText(text).closest('[data-dimmed]')!.getAttribute('data-dimmed');
    expect(dimmed('hello')).toBe('false');
    expect(dimmed('a notice')).toBe('false');
    expect(dimmed('from the coordinator')).toBe('true');
    expect(dimmed('Open the PR')).toBe('true');
    expect(dimmed('Build it')).toBe('false');
    expect(screen.getByRole('button', { name: /Developer/ }).closest('[data-dimmed]')).toHaveAttribute('data-dimmed', 'false');
  });

  it('dims an interim message and the question of another agent, and keeps the question of the focused one', () => {
    renderFeed([
      { id: 'i1', at: AT, type: 'interim', text: 'working on it' },
      { id: 'q1', at: AT, type: 'question', askerRole: 'PRODUCT_OWNER', askerRoleName: 'Product Owner', text: 'Which scope?', options: [], number: 1, total: 1, closed: true },
      { id: 'q2', at: AT, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', text: 'Which branch?', options: [], number: 1, total: 1, closed: true },
    ], '', 'DEVELOPER');

    const dimmed = (text: string) => screen.getByText(text).closest('[data-dimmed]')!.getAttribute('data-dimmed');
    expect(dimmed('working on it')).toBe('true');
    expect(dimmed('Which scope?')).toBe('true');
    expect(dimmed('Which branch?')).toBe('false');
  });

  it('attributes an activity group to the role of its first step', () => {
    renderFeed([
      { id: 'x1', at: AT, type: 'tool', role: 'CEO', title: 'Read file', status: 'completed' },
      { id: 'n1', at: AT, type: 'notice', level: 'info', text: 'a notice' },
      { id: 'x2', at: AT, type: 'tool', role: 'DEVELOPER', title: 'Run tests', status: 'completed' },
    ], '', 'DEVELOPER');

    const flags = Array.from(document.querySelectorAll('[data-dimmed]'), element => element.getAttribute('data-dimmed'));
    expect(flags).toEqual(['true', 'false', 'false']);
  });

  it('dims nothing without a focus', () => {
    renderFeed([{ id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'plain' }]);

    expect(screen.getByText('plain').closest('[data-dimmed]')).toHaveAttribute('data-dimmed', 'false');
  });

  describe('open question', () => {
    const question = (closed: boolean): ConversationEntry => ({
      id: 'q1', at: AT, type: 'question', askerRole: 'TECH_LEAD', askerRoleName: 'Tech Lead', text: 'Which branch?', options: ['main', 'dev'], number: 1, total: 1, closed,
    });
    const reply: ConversationEntry = { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'Merge requests are open' };

    function renderQuestionFeed(entries: ConversationEntry[], viewportHeight: number, onAnswer = vi.fn(), handle = createRef<FeedHandle>()) {
      render(
        <VirtuosoMockContext.Provider value={{ viewportHeight, itemHeight: 100 }}>
          <FeedList ref={handle} team={[]} entries={entries} draft="" running focus={null} onFocus={vi.fn()} onHover={vi.fn()} onAnswer={onAnswer} />
        </VirtuosoMockContext.Provider>,
      );
      return { onAnswer, handle };
    }

    it('shows no waiting line while the open question is in view', () => {
      renderQuestionFeed([question(false), reply], 100_000);

      expect(screen.queryByRole('button', { name: 'Go to question' })).not.toBeInTheDocument();
    });

    it('stays answerable after a newer entry and sends the answer', async () => {
      const user = userEvent.setup();
      const { onAnswer } = renderQuestionFeed([question(false), reply], 100_000);

      await user.click(screen.getByRole('button', { name: 'dev' }));

      expect(onAnswer).toHaveBeenCalledWith({ kind: 'option', optionIndex: 2 });
      expect(screen.queryByText('Tech Lead is waiting for your answer')).not.toBeInTheDocument();
    });

    it('shows a closed question in its closed form', () => {
      renderQuestionFeed([question(true), reply], 100_000);

      expect(screen.getByText('Which branch?')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'dev' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
    });

    it('keeps the agents shown as working unless the open question is the last entry', () => {
      const { unmount } = render(
        <VirtuosoMockContext.Provider value={{ viewportHeight: 100_000, itemHeight: 100 }}>
          <FeedList team={[]} entries={[question(false)]} draft="" running focus={null} onFocus={vi.fn()} onHover={vi.fn()} onAnswer={vi.fn()} />
        </VirtuosoMockContext.Provider>,
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      unmount();

      render(
        <VirtuosoMockContext.Provider value={{ viewportHeight: 100_000, itemHeight: 100 }}>
          <FeedList team={[]} entries={[question(false), userEntry('u2')]} draft="" running focus={null} onFocus={vi.fn()} onHover={vi.fn()} onAnswer={vi.fn()} />
        </VirtuosoMockContext.Provider>,
      );
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('focuses the first control of the question card through the handle', () => {
      const { handle } = renderQuestionFeed([question(false), reply], 100_000);

      act(() => handle.current?.goToQuestion());

      expect(screen.getByRole('button', { name: 'main' })).toHaveFocus();
    });

    it('does nothing through the handle without an open question', () => {
      const { handle } = renderQuestionFeed([question(true), reply], 100_000);

      act(() => handle.current?.goToQuestion());

      expect(document.body).toHaveFocus();
    });
  });
});
