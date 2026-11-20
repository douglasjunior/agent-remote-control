import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const GIT_REMOTE_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.gitRemote,
  description: 'Working with a Git hosting provider - choosing between the provider\'s MCP tools and its official CLI, pushing a branch, opening, updating and merging a pull request, and what to do when authentication fails. Read before the first push, pull request or merge of a session.',
  roles: ['DEVELOPER', 'GIT_OPS'],
  buildContent: () => `# Git Remote

## Provider and Tooling
- Find the provider with \`git remote -v\`: GitHub, GitLab, Azure DevOps or Bitbucket.
- Use, in this order: the provider's MCP tools when your session has them; otherwise its official CLI when it is installed and authenticated (\`gh auth status\`, \`glab auth status\`, \`az account show\`). Without either, do not fall back to \`curl\`, raw REST calls or ad-hoc scripts: push with plain Git and say in your final answer that the pull request could not be opened and why.
- A repository without a remote has nothing to push: the branch stays local, and your final answer says so.

## Pushing a Branch
- Push only the branch you were given: \`git push -u origin <branch>\`. A push that is rejected is reported with the exact Git error; forcing it is a destructive operation that needs an explicit instruction naming it.
- An authentication failure (\`Permission denied (publickey)\`, a 401 or 403, a credential prompt) is not yours to work around: report the exact error and the transport the remote uses (SSH or HTTPS), so the caller can route the fix.

## Opening a Pull Request
- One pull request per task. When the task already links an open one, pushing the branch updates it: do not open another.
- Target the branch the task or the team's workflow names; without one, the repository's default branch.
- Title it with the task id and title (\`T-3: Login API\`), unless the project or the team's workflow sets another convention.
- Describe it from the task: what it delivers (overview), how to verify it (acceptance criteria and your implementation notes), and anything the reviewer should look at first.
- Record it on the task: \`<pull_request url="https://..." title="T-3: Login API" state="open"/>\` inside the \`<artifact_update>\` of the task.

## Merging a Pull Request
- Merge only on an instruction to merge that pull request, into the branch it targets, with the merge method the project or the team's workflow sets (the provider's default without one).
- Checks still running or failing, or a merge conflict, stop the merge: report the state from the provider's own output.
- After a merge, record the new state on the task (\`state="merged"\`) and report the merge commit.
`,
};
