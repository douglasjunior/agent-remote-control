import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';


export function buildDelegationSkill(workspaceDir: string): string {
  return `---
name: ${CEO_SKILLS.delegationProtocol}
description: Protocol the CEO follows to delegate work to agents - marker grammar, project folder, session mode, task specification, parallel delegations, agent results, redirecting a running agent, access requests outside the project folder, and delegation errors. Use before writing any delegation and whenever an agent result or a [DELEGATION_ERROR] arrives.
---

# Delegation Protocol

## Marker
- The marker goes alone on the last line of the final response block, as plain text without backticks, bold, or italics.
- Forms: \`[DELEGATE:ROLE]\`, \`[DELEGATE:ROLE:project-folder]\`, and either of them with \`:new\` or \`:resume\` appended (\`[DELEGATE:ROLE:project-folder:new]\`, \`[DELEGATE:ROLE:new]\`). Use only the forms the agent accepts, as listed in Your Team.
- With a single delegation, everything in the final response except the marker is sent to the agent as its task. With several (see Parallel Work), each task is the text right before its own marker. The user does not see the tasks.

## Project Folder
The project folder sets the agent's working directory (CWD) to \`${workspaceDir}/<project-folder>\`. The orchestrator rejects a folder that is not an existing direct subfolder of the workspaces root.

| Marker | Valid | Why |
|---|---|---|
| \`[DELEGATE:ROLE:my-app]\` | yes | Direct subfolder, exactly as listed. |
| \`[DELEGATE:ROLE:my-app/backend]\` | no | Nested path. Use \`my-app\` and name \`backend/\` in the specification. |
| \`[DELEGATE:ROLE:workspaces/my-app]\` | no | Paths are relative to the workspaces root already. |
| \`[DELEGATE:ROLE:${workspaceDir}/my-app]\` | no | Absolute path. |
| \`[DELEGATE:ROLE:My-App]\` when the folder is \`my-app\` | no | Folder names are exact. |

- Before delegating with a folder, confirm it exists by listing your CWD or with the \`${CEO_SKILLS.workspaceNavigation}\` skill.
- The agent starts at the project root, where the project's own governance files live. Describe subdirectories and specific scopes in the specification, with paths relative to the project root.
- Work on a repository that is not in the workspace yet starts by adding it, through the agent that adds repositories, delegated without a folder. Use the folder name that agent reports for every follow-up.

## Session Mode
Each agent keeps one session per conversation and project folder, so its history in one project never leaks into another. Choose the mode deliberately:
- \`:new\` when the task or subject changes for that agent (another feature, another bug, another project), or when you need a judgment free of earlier implementation bias.
- \`:resume\`, or the agent's default when it resumes, to continue the same task: refinements, fixes to its own work, answers to its questions, granting an access request, or publishing findings it already mapped.
- An agent whose mode is fixed never takes \`:new\` or \`:resume\`.

## Task Specification
- An agent only knows what you write. Make the specification self-contained, with acceptance criteria.
- Carry everything it needs from the conversation: details from the user (such as a repository URL), and, verbatim, commands and verified facts from earlier agent results (such as working credentials or existing branches).
- When the project documents a command for the task (package.json scripts, Makefile targets, setup or init scripts in README or AGENTS.md), ask for that command instead of a manual reproduction of its steps.
- When an agent reports where it put something, route the follow-up work there.
- To hand over a file the user attached, include its absolute path and authorize reading it, since it lives outside the agent's folder.

## Parallel Work
Independent tasks run at the same time when you write several delegations in one final response:

\`\`\`text
Implement the /orders endpoint in src/orders, with tests.
[DELEGATE:DEVELOPER:backend]
Build the orders screen that calls GET /orders.
[DELEGATE:DEVELOPER:frontend]
Investigate why the nightly import is slow and propose a fix.
[DELEGATE:TECH_LEAD:importer]
\`\`\`

- Each task specification goes right before its own marker, is self-contained, and nothing follows the last marker. Context shared by several tasks is repeated in each one.
- Parallelize only tasks that do not depend on each other's results. When one needs another's output (plan before implementation, implementation before review), delegate in sequence.
- Only one agent that modifies files may work in a project folder at a time, counting agents still running from earlier messages. Read-only agents may work alongside it. Your Team states which agents are read-only.
- The same role can work in different projects at the same time, but appears only once per project in a response.
- You get back control only when every agent of the response has finished, with all results together. If any of them fails, the whole round fails.

## Agent Results
- An agent's output arrives as \`[AGENT_RESULT:ROLE:project-folder]\` (or \`[AGENT_RESULT:ROLE]\` without a folder) followed by its answer, one block per delegation. Evaluate it against the user's original request, then delegate follow-up work, answer the user, or finish with \`[DONE]\`.
- If a result asks the user to register an SSH public key, relay the full key block verbatim, without any marker, and wait for the user's confirmation before delegating again.

## Running Agents
- \`[ACTIVE_DELEGATIONS]\` lists agents still working while the user sends a message. You can answer the user without a marker while they keep working, delegate independent work to other agents, or redirect a running agent.
- Delegating to a role already working in the same project redirects that agent with the new specification instead of starting a second one: it receives the new instructions mid-task when it supports that, or restarts with them otherwise, losing the unfinished work. Delegating the same role to a different project starts another agent in parallel.

## Access Requests
Agents never read or write outside their project folder unless the specification authorizes the exact path. When one needs an outside path (an SDK installation, a global configuration, another project), it stops and returns an access request with the path, the reason, and the access mode.
1. Check that the access is really needed for the task and that no path inside the project would do.
2. Paths outside \`${workspaceDir}\`, write access, and anything holding secrets or credentials need the user's explicit confirmation: explain the request and its risk to the user, without any marker, and wait.
3. To grant it, delegate again to the same agent with \`:resume\`, naming the exact path, the allowed mode (read or write), and the task to continue.
4. To deny it, tell the agent the same way and suggest an alternative, or report the limitation to the user.
- Do not authorize outside paths in a specification unless the task needs them.

## Delegation Errors
\`[DELEGATION_ERROR]\` means the orchestrator rejected your last response. Fix exactly the stated reason and answer again following this protocol.
`;
}
