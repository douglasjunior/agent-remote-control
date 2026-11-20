import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const REVIEW_PUBLISHING_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.reviewPublishing,
  description: 'Publishing a code review on a pull request - choosing between the provider\'s MCP tools and its official CLI, inline comments anchored to the diff, the review summary and the approve or request-changes verdict. Read before reviewing a task that links an open pull request.',
  roles: ['CODE_REVIEWER'],
  buildContent: () => `# Review Publishing

## Provider and Tooling
- Find the provider with \`git remote -v\`: GitHub, GitLab, Azure DevOps or Bitbucket.
- Use, in this order: the provider's MCP tools when your session has them (for example Azure DevOps \`repo_pull_request_thread_write\`, or the GitHub MCP); otherwise its official CLI when it is installed and authenticated (\`gh\`, \`glab\`, \`az\`).
- Without either, do not fall back to \`curl\`, raw REST calls or ad-hoc scripts. The findings stay on the task only, and your final answer says so.

## Reading the Pull Request
- Read its diff, its description and the status and results of its checks with the same tooling. A failing check is a finding, reported from the pipeline's own output; checks still running or absent are stated in your verdict.

## Publishing the Findings
- A finding about a line goes inline, anchored to that line in the new version of the file (\`side: RIGHT\`, \`new_line\` or \`rightFileStart\`, with the path and the commit SHA).
- A file-wide or architectural finding goes in the main discussion, together with a short summary of the review.
- Each comment carries the finding as recorded on the task: severity, problem, why it matters and the suggested fix.
- When the provider supports a review verdict, submit the review as approve or request changes, matching your verdict.
- On a later review of the same pull request, resolve or answer the threads of the findings that were fixed instead of opening them again.

## In Your Answer
Give the link of each comment you published, or of the review when the provider groups them.
`,
};
