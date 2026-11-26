import { parseServerEvent } from './server-event.js';


const at = '2026-01-01T00:00:00.000Z';
const conversation = { id: 'c', title: 'T', createdAt: at, updatedAt: at };
const entry = { id: '1', at, type: 'interim', text: 'x' };
const artifact = {
  id: 'T-1',
  type: 'task',
  title: 'Login',
  status: 'in_progress',
  parentId: 'F-1',
  projectName: 'app',
  projectNames: ['app'],
  dependsOn: ['T-2'],
  refinement: { business: 'done', design: 'pending', technical: 'skipped' },
  assignee: { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd', since: at },
  branch: 'feat/login',
  pullRequests: [{ url: 'https://example.com/pr/1', repository: 'repositories/api', state: 'open', addedAt: at }],
  createdAt: at,
  updatedAt: at,
};
const history = [
  { id: 'h1', at, actor: { kind: 'user', channel: 'web' }, kind: 'created', summary: 'Created' },
  { id: 'h2', at, actor: { kind: 'agent', role: 'CEO', roleName: 'CEO' }, kind: 'updated', summary: 'Status', changes: [{ field: 'status', from: 'ready', to: 'in_progress' }] },
  { id: 'h3', at, actor: { kind: 'system' }, kind: 'commented', summary: 'Comment', text: 'Hi' },
];

describe('parseServerEvent', () => {
  it.each([
    { type: 'auth.ok' },
    { type: 'auth.failed' },
    { type: 'pong' },
    { type: 'conversation.list', conversations: [conversation] },
    { type: 'conversation.created', requestId: 'r', conversation },
    { type: 'conversation.updated', conversation },
    { type: 'conversation.history', conversationId: 'c', entries: [entry], start: 0, state: 'idle' },
    { type: 'conversation.entry', conversationId: 'c', entry, position: 12 },
    { type: 'conversation.history', conversationId: 'c', entries: [entry], start: 40, state: 'running', draft: 'Working on' },
    { type: 'conversation.entries', conversationId: 'c', entries: [entry], start: 0 },
    { type: 'conversation.draft', conversationId: 'c', text: 'Working on it' },
    { type: 'conversation.draft', conversationId: 'c', text: '' },
    { type: 'conversation.state', conversationId: 'c', state: 'running' },
    { type: 'projects.list', projects: ['app'] },
    { type: 'skills.list', skills: [{ name: 'api-testing', description: 'API.', roles: ['QA'], builtIn: true }] },
    { type: 'skill.detail', name: 'api-testing', skill: { name: 'api-testing', description: 'API.', roles: ['QA'], builtIn: true, content: '# API' } },
    { type: 'skill.detail', name: 'missing', skill: null },
    {
      type: 'settings',
      settings: [
        { key: 'USER_LANGUAGE', group: 'general', apply: 'live', envOnly: false, source: 'default', kind: 'text', value: 'English', defaultValue: 'English' },
        { key: 'DISCORD_ENABLED', group: 'discord', apply: 'live', envOnly: false, source: 'env', kind: 'boolean', value: false, defaultValue: true },
        { key: 'DISCORD_BOT_TOKEN', group: 'discord', apply: 'live', envOnly: false, source: 'saved', kind: 'secret', value: { set: true } },
        { key: 'QUESTION_TIMEOUT_MS', group: 'general', apply: 'live', envOnly: false, source: 'saved', kind: 'integer', value: 0, defaultValue: 300_000 },
        { key: 'SHELL_COMMAND_ENABLED', env: 'SHELL_COMMAND_ENABLED', group: 'shell', apply: 'live', envOnly: true, source: 'env', kind: 'boolean', value: true, defaultValue: false },
        { key: 'STT_PROVIDER', group: 'speech', apply: 'restart', envOnly: false, source: 'default', kind: 'choice', value: 'whisper-cpp', defaultValue: 'whisper-cpp', options: ['whisper-cpp', 'none'] },
      ],
    },
    { type: 'settings.result', requestId: 'r', ok: true },
    { type: 'settings.result', requestId: 'r', ok: false, error: 'Unknown setting: PORT' },
    { type: 'settings.discord.test.result', ok: true, botName: 'arc-bot', guildName: 'Home' },
    { type: 'settings.discord.test.result', ok: true, botName: 'arc-bot' },
    { type: 'settings.discord.test.result', ok: false, error: 'Discord refused the token.' },
    { type: 'artifacts.list', conversationId: 'c', artifacts: [artifact] },
    { type: 'artifact.detail', conversationId: 'c', artifact: { ...artifact, sections: { overview: 'Why' }, history } },
    { type: 'artifact.updated', conversationId: 'c', artifact },
    { type: 'artifact.updated', conversationId: 'c', artifact: { ...artifact, id: 'F-1', type: 'feature', parentId: null, projectName: null, projectNames: ['app', 'site'] } },
    { type: 'artifact.deleted', conversationId: 'c', id: 'T-1' },
    { type: 'artifact.result', conversationId: 'c', requestId: 'r', ok: true, id: 'T-1' },
    { type: 'artifact.result', conversationId: 'c', requestId: 'r', ok: false, error: 'Unknown artifact' },
    { type: 'prompts.list', requestId: 'r', prompts: ['latest', 'older'] },
    {
      type: 'files.results',
      requestId: 'r',
      items: [{ path: 'app/src/', kind: 'directory', matches: [0, 4] }, { path: 'app/a.ts', kind: 'file', matches: [] }],
      walking: true,
    },
    { type: 'upload.ready', uploadId: 'u' },
    { type: 'upload.ack', uploadId: 'u', index: 3 },
    { type: 'upload.done', uploadId: 'u', attachment: { path: '.arc-uploads/c/a.png', name: 'a.png' } },
    { type: 'upload.failed', uploadId: 'u', reason: 'Too large' },
    { type: 'agents.list', agents: [{ id: 'claude', name: 'Claude Code', description: 'CLI' }, { id: 'codex', name: 'Codex' }] },
    {
      type: 'quota.report',
      fetchedAt: at,
      reports: [
        {
          agent: { id: 'claude', name: 'Claude Code' },
          status: 'ok',
          quota: { groups: [{ name: 'Limits', buckets: [{ id: 'five', name: 'Session', window: '5h', remainingFraction: 1.2, resetTime: at }] }] },
        },
        { agent: { id: 'cursor', name: 'Cursor' }, status: 'unsupported' },
      ],
    },
    { type: 'quota.failed' },
    {
      type: 'auth.status',
      fetchedAt: at,
      agents: [
        { agentId: 'claude', displayName: 'Claude Code', status: 'authenticated', detail: 'me@example.com' },
        { agentId: 'codex', displayName: 'OpenAI Codex', status: 'unauthenticated' },
        { agentId: 'cursor', displayName: 'Cursor', status: 'unknown' },
      ],
    },
    { type: 'auth.status.failed' },
    { type: 'auth.login', agentId: 'codex', event: { kind: 'url', url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' } },
    { type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://claude.com/oauth' } },
    { type: 'auth.login', agentId: 'claude', event: { kind: 'prompt', hint: 'Paste code here >' } },
    { type: 'auth.login', agentId: 'claude', event: { kind: 'completed' } },
    { type: 'auth.login', agentId: 'claude', event: { kind: 'failed', reason: 'Invalid code.' } },
    { type: 'auth.login', agentId: 'claude', event: { kind: 'cancelled' } },
    { type: 'models.list', agentId: 'claude', models: [{ id: 'opus', name: 'Opus' }] },
    { type: 'efforts.list', agentId: 'claude', modelId: 'opus', efforts: [{ id: 'high', name: 'High' }] },
    { type: 'profiles', conversationId: 'c', configured: false, profiles: [{ role: 'CEO', roleName: 'CEO' }], customized: false },
    {
      type: 'profiles',
      conversationId: 'c',
      configured: true,
      appliedSquad: { id: 's', name: 'Backend team' },
      customized: true,
      profiles: [
        {
          role: 'CEO',
          roleName: 'CEO',
          agent: { id: 'claude', name: 'Claude Code', available: true },
          model: { id: 'opus', name: 'Opus' },
          effort: { id: 'high', name: 'High' },
        },
      ],
    },
    { type: 'squads', squads: [] },
    {
      type: 'squads',
      squads: [
        {
          id: 's',
          name: 'Backend team',
          description: 'APIs',
          isDefault: true,
          profiles: [{ role: 'CEO', roleName: 'CEO', agent: { id: 'claude', name: 'Claude Code', available: false } }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    },
    { type: 'error', message: 'boom', conversationId: 'c' },
    { type: 'error', message: 'boom' },
  ])('should accept $type', (event) => {
    expect(parseServerEvent(event)).toEqual({ ok: true, value: event });
  });

  it('should read a pull request without a repository as the project folder itself', () => {
    const { repository: _repository, ...link } = artifact.pullRequests[0]!;

    expect(parseServerEvent({ type: 'artifact.updated', conversationId: 'c', artifact: { ...artifact, pullRequests: [link] } }))
      .toMatchObject({ ok: true, value: { artifact: { pullRequests: [{ repository: '.' }] } } });
  });

  it.each([
    ['unknown type', { type: 'nope' }],
    ['missing fields', { type: 'conversation.state', conversationId: 'c' }],
    ['invalid state', { type: 'conversation.state', conversationId: 'c', state: 'x' }],
    ['draft without text', { type: 'conversation.draft', conversationId: 'c' }],
    ['history with a non-string draft', { type: 'conversation.history', conversationId: 'c', entries: [], start: 0, state: 'idle', draft: 1 }],
    ['history without a start', { type: 'conversation.history', conversationId: 'c', entries: [], state: 'idle' }],
    ['entries with a negative start', { type: 'conversation.entries', conversationId: 'c', entries: [], start: -1 }],
    ['prompts.list with a non-string prompt', { type: 'prompts.list', requestId: 'r', prompts: [1] }],
    ['files.results without matches', { type: 'files.results', requestId: 'r', items: [{ path: 'a', kind: 'file' }], walking: false }],
    ['files.results with a negative match index', { type: 'files.results', requestId: 'r', items: [{ path: 'a', kind: 'file', matches: [-1] }], walking: false }],
    ['files.results with an unknown kind', { type: 'files.results', requestId: 'r', items: [{ path: 'a', kind: 'link', matches: [] }], walking: false }],
    ['upload.done without a path', { type: 'upload.done', uploadId: 'u', attachment: { name: 'a' } }],
    ['upload.ack with a negative index', { type: 'upload.ack', uploadId: 'u', index: -1 }],
    ['profile without availability', { type: 'profiles', conversationId: 'c', configured: true, profiles: [{ role: 'CEO', roleName: 'CEO', agent: { id: 'a', name: 'A' } }], customized: false }],
    ['profiles without the customized flag', { type: 'profiles', conversationId: 'c', configured: true, profiles: [] }],
    ['a squad without the default flag', { type: 'squads', squads: [{ id: 's', name: 'A', profiles: [], createdAt: 'x', updatedAt: 'x' }] }],
    ['an auth status with an unknown state', { type: 'auth.status', fetchedAt: '2026-11-07T00:00:00.000Z', agents: [{ agentId: 'a', displayName: 'A', status: 'maybe' }] }],
    ['a login event of an unknown kind', { type: 'auth.login', agentId: 'claude', event: { kind: 'x' } }],
    ['invalid entry', { type: 'conversation.entry', conversationId: 'c', entry: { type: 'x' }, position: 0 }],
    ['entry without a position', { type: 'conversation.entry', conversationId: 'c', entry: { id: 'e', at: '2026-01-01T00:00:00.000Z', type: 'user_message', text: 'hi' } }],
    ['an artifact without projects', { type: 'artifact.updated', conversationId: 'c', artifact: { ...artifact, projectNames: [] } }],
    ['null', null],
    ['array', []],
  ])('should reject %s', (_label, data) => {
    const result = parseServerEvent(data);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error', expect.any(String));
  });
});
