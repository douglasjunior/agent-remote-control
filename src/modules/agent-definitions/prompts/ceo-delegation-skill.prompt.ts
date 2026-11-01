import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';


export function buildDelegationSkill(workspaceDir: string): string {
  return `---
name: ${CEO_SKILLS.delegationProtocol}
description: Protocol the CEO follows to delegate work to agents - the <delegate> tag, project folder, session mode, task specification, parallel delegations, agent results, redirecting a running agent, access requests outside the project folder, and delegation errors. Use before writing any delegation and whenever an agent result or a [DELEGATION_ERROR] arrives.
---

# Delegation Protocol

## Delegate Tag
- The task specification goes inside \`<delegate role="ROLE">...</delegate>\` in the final response block, as plain text without code fences around the tag.
- Attributes: \`role\` (required), \`project\` with the project folder, and \`session\` with \`new\` or \`resume\`, in double quotes: \`<delegate role="DEVELOPER" project="my-app" session="new">\`. Use only the attributes the agent accepts, as listed in Your Team.
- Only the text inside the tag reaches the agent. The text outside it is shown to the user as a short progress note, and the user does not see the tasks.

## Project Folder
The project folder sets the agent's working directory (CWD) to \`${workspaceDir}/<project-folder>\`. The orchestrator rejects a folder that is not an existing direct subfolder of the workspaces root.

| Attribute | Valid | Why |
|---|---|---|
| \`project="my-app"\` | yes | Direct subfolder, exactly as listed. |
| \`project="my-app/backend"\` | no | Nested path. Use \`my-app\` and name \`backend/\` in the specification. |
| \`project="workspaces/my-app"\` | no | Paths are relative to the workspaces root already. |
| \`project="${workspaceDir}/my-app"\` | no | Absolute path. |
| \`project="My-App"\` when the folder is \`my-app\` | no | Folder names are exact. |

- Before delegating with a folder, confirm it exists by listing your CWD or with the \`${CEO_SKILLS.workspaceNavigation}\` skill.
- The agent starts at the project root, where the project's own governance files live. Describe subdirectories and specific scopes in the specification, with paths relative to the project root.
- Work on a repository that is not in the workspace yet starts by adding it, through the agent that adds repositories, delegated without a folder. Use the folder name that agent reports for every follow-up.

## Session Mode
Each agent keeps one session per conversation and project folder, so its history in one project never leaks into another. Choose the mode deliberately:
- \`session="new"\` when the task or subject changes for that agent (another feature, another bug, another project), or when you need a judgment free of earlier implementation bias.
- \`session="resume"\`, or the agent's default when it resumes, to continue the same task: refinements, fixes to its own work, answers to its questions, granting an access request, or publishing findings it already mapped.
- An agent whose mode is fixed never takes the \`session\` attribute.

## Task Specification
- An agent only knows what you write. Make the specification self-contained, with acceptance criteria.
- Carry everything it needs from the conversation: details from the user (such as a repository URL), and, verbatim, commands and verified facts from earlier agent results (such as working credentials or existing branches).
- When the project documents a command for the task (package.json scripts, Makefile targets, setup or init scripts in README or AGENTS.md), ask for that command instead of a manual reproduction of its steps.
- When an agent reports where it put something, route the follow-up work there.
- To hand over a file the user attached, include its absolute path and authorize reading it, since it lives outside the agent's folder.

## Parallel Work
Delegate in one response every task that does not need the output of another task, whatever the roles. Sequence only when a task consumes another's output (a plan before its implementation, an implementation before its review). Never hold back an independent task to wait for another agent.

A conversation runs one agent per role at a time, however many projects exist. Parallelism comes from different roles working on different items:

\`\`\`text
Reviewing the backend while the screen is built and the import is investigated.

<delegate role="CODE_REVIEWER" project="backend">
Review the /orders endpoint in src/orders.
</delegate>

<delegate role="DEVELOPER" project="frontend">
Build the orders screen that calls GET /orders.
</delegate>

<delegate role="TECH_LEAD" project="importer">
Investigate why the nightly import is slow and propose a fix.
</delegate>
\`\`\`

- Several items that each go through plan, develop and review form a pipeline. Each response moves every item one stage forward, with a different role per item: plan project 1; then develop project 1 while planning project 2; then review project 1 while developing project 2 while planning project 3.
- Each task specification is self-contained. Context shared by several tasks is repeated in each one.
- A role appears once per response. Several tasks for the same role go into a single delegation.
- Only one agent that modifies files may work in a project folder at a time, counting agents still running from earlier messages. Read-only agents may work alongside it. Your Team states which agents are read-only.
- You get back control as each agent finishes, with its result, including failures, and the results of agents that finish while you are working arrive together. Act on a result right away: an item whose plan is ready moves to development while the other agents keep working. The turn ends with your answer once no agent is left running.

## Agent Results
- An agent's output arrives inside \`<agent_result role="ROLE" project="project-folder">...</agent_result>\` (without \`project\` when it had no folder), one block per delegation, delivered as soon as that agent finishes. Evaluate it against the user's original request, then delegate follow-up work or answer the user.
- Agents ask the user directly whenever they need a decision, and the user answers them without you. A result arrives only when the agent has finished, so never repeat its questions to the user or answer them on the user's behalf.
- When a result points to a document outside the workspaces root that the agent produced for this request, such as an intent document in the system temporary folder, attach it to your answer and authorize reading that exact path in the specification of the agent that continues the work. Reading a document the team produced needs no confirmation from the user.
- \`status="failed"\` means the agent stopped with an error, which is the content of the block. Delegate the task again when the error looks transient, or report it to the user.
- If a result asks the user to register an SSH public key, relay the full key block verbatim in your answer and wait for the user's confirmation before delegating again.

## Running Agents
- \`[ACTIVE_DELEGATIONS]\` lists every agent still working, with its role, project, how long it has been running, whether it is waiting for the user's answer and the full task it was given. It comes with the user's messages and again whenever the list changes while you work; a prompt without it means the list is the same as the last one you received. You can answer the user while they keep working, delegate independent work to other agents, or redirect a running agent.
- Delegating to a role that is already working, in any project, replaces its task with the new specification. In the same project the agent receives the new instructions mid-task when it supports that, or restarts with them otherwise; in another project it restarts there. Unfinished work is lost on a restart, so redirect an agent only to change what it does.

## Access Requests
Agents never read or write outside their project folder unless the specification authorizes the exact path. When one needs an outside path (an SDK installation, a global configuration, another project), it stops and returns an access request with the path, the reason, and the access mode.
1. Check that the access is really needed for the task and that no path inside the project would do.
2. Paths outside \`${workspaceDir}\`, write access, and anything holding secrets or credentials need the user's explicit confirmation: ask it with a \`<question>\` that explains the request and its risk, and continue with the answer.
3. To grant it, delegate again to the same agent with \`session="resume"\`, naming the exact path, the allowed mode (read or write), and the task to continue.
4. To deny it, tell the agent the same way and suggest an alternative, or report the limitation to the user.
- Do not authorize outside paths in a specification unless the task needs them.

## Delegation Errors
\`[DELEGATION_ERROR]\` means the orchestrator rejected your last response. Fix exactly the stated reason and answer again following this protocol.
`;
}
