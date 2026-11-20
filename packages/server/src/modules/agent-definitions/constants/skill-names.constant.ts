/** The names of the built-in skills, the one place a prompt or another skill takes them from. */
export const SKILL_NAMES = {
  agentTeam: 'agent-team',
  artifactBoard: 'artifact-board',
  delegationProtocol: 'delegation-protocol',
  responseProtocol: 'response-protocol',
  workspaceNavigation: 'workspace-navigation',
  skillAuthoring: 'skill-authoring',
  boardRequests: 'board-requests',
  askingTheUser: 'asking-the-user',
  runningTheApp: 'running-the-app',
  webUiTesting: 'web-ui-testing',
  apiTesting: 'api-testing',
  mobileTesting: 'mobile-testing',
  gitRemote: 'git-remote',
  repositorySetup: 'repository-setup',
  reviewPublishing: 'review-publishing',
  roleGuide: 'role-guide',
} as const;
