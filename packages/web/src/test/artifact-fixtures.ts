import type { ArtifactDetail, ArtifactSummary } from '@agent-remote-control/protocol/artifact';
import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { act, fireEvent, screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

import { AT, renderApp, roleProfiles, type AppHarness } from './render-app.js';


export const CONVERSATION_ID = 'c1';

export function summary(overrides: Partial<ArtifactSummary> & Pick<ArtifactSummary, 'id'>): ArtifactSummary {
  return {
    type: 'task',
    title: `Title of ${overrides.id}`,
    status: 'backlog',
    parentId: null,
    projectName: 'app',
    dependsOn: [],
    refinement: { business: 'pending', technical: 'pending' },
    assignee: null,
    branch: null,
    pullRequests: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function detail(overrides: Partial<ArtifactDetail> & Pick<ArtifactDetail, 'id'>): ArtifactDetail {
  return { ...summary(overrides), sections: {}, history: [], ...overrides };
}

/** Renders conversation `c1` at `path` with the artifacts and projects the server would list. */
export function openBoard(
  artifacts: readonly ArtifactSummary[],
  { path = `/c/${CONVERSATION_ID}/tasks`, projects = ['app', 'site'] }: { path?: string; projects?: readonly string[] } = {},
): AppHarness {
  const app = renderApp(path);
  act(() => {
    app.connection.emitEvent({ type: 'conversation.list', conversations: [{ id: CONVERSATION_ID, title: 'My task', createdAt: AT, updatedAt: AT }] });
    app.connection.emitEvent({ type: 'conversation.history', conversationId: CONVERSATION_ID, entries: [], start: 0, state: 'idle' });
    app.connection.emitEvent({ type: 'profiles', conversationId: CONVERSATION_ID, configured: true, profiles: roleProfiles, customized: false });
    app.connection.emitEvent({ type: 'artifacts.list', conversationId: CONVERSATION_ID, artifacts: [...artifacts] });
    app.connection.emitEvent({ type: 'projects.list', projects: [...projects] });
  });
  return app;
}

/** Sends the detail of an artifact of `c1`, as the server answers `artifact.get`. */
export function showDetail(app: AppHarness, artifact: ArtifactDetail): void {
  act(() => app.connection.emitEvent({ type: 'artifact.detail', conversationId: CONVERSATION_ID, artifact }));
}

type Command = ClientCommand['type'];

/** The last command of `type` the app sent. */
export function lastSent<T extends Command>(app: AppHarness, type: T): Extract<ClientCommand, { type: T }> {
  const command = app.connection.sent.filter(sent => sent.type === type).at(-1);
  if (!command) {
    throw new Error(`No ${type} was sent`);
  }
  return command as Extract<ClientCommand, { type: T }>;
}

/** Answers the last mutation of `type` the app sent. */
export async function answer(
  app: AppHarness,
  type: 'artifact.create' | 'artifact.update' | 'artifact.comment' | 'artifact.delete',
  result: { ok: true; id: string } | { ok: false; error: string },
): Promise<void> {
  const { requestId } = lastSent(app, type);
  await act(async () => {
    app.connection.emitEvent({ type: 'artifact.result', conversationId: CONVERSATION_ID, requestId, ...result });
  });
}

/** The `dataTransfer` of a drag, which jsdom does not provide. */
export function dataTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: '',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  };
}

export function dragTo(card: HTMLElement, column: HTMLElement): void {
  const transfer = dataTransfer();
  fireEvent.dragStart(card, { dataTransfer: transfer });
  fireEvent.drop(column, { dataTransfer: transfer });
}

export async function pick(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}
