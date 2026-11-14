# Git Ops Agent Prompt (`git-ops.prompt.ts`)

**Role**: Owner of standalone Git operations that reach a remote — clone, init, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests and SSH key setup. Maintains `workspace-manifest.json` at the workspaces root as a mapping from repository URL to project folder, and is its only writer (the CEO reads it to locate repositories). Does not run project scripts, even when they clone or fetch internally.

`GIT_OPS_SYSTEM_PROMPT` and `GIT_OPS_TURN_REMINDER`.

- Owner of every Git operation that reaches a remote: clone, init, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests and SSH key setup; `$HOME/.ssh` is authorized in its own prompt for the SSH key setup;
- Leaves the local side to the implementing agent: staging, commit, local branch and working tree inspection. Destructive operations (force push, deleting remote branches or tags, discarding uncommitted or unpushed work) run only on an explicit instruction that names the operation and its target; a rejected push or failure is never one. They use the narrowest form: `--force-with-lease` for force push, one named ref per deletion, never `--all`, `--mirror` or wildcard refspecs;
- Operates in one of two directories, decided by the caller: the workspaces root, to clone or locate a repository, and a project folder, for operations on that repository. That is why its contract declares `project: 'optional'`;
- Sole reader and writer of `workspace-manifest.json` at the workspaces root, a JSON array of `{ url, folder, defaultBranch }` that maps repository URL to project folder. A missing file means an empty workspace;
- Derives the folder name from the last segment of the URL without the `.git` suffix, an exact rule because the caller routes subsequent work by that name and a different name would duplicate the clone;
- Reports in `GIT_OPS_TURN_REMINDER` the project folder used, since that is how the CEO learns where to route the follow-up;
- With a task (`artifact: 'optional'`), pushes its branch, opens its pull request (titled with the task id and title, described from the task) and links every pull request it opens, merges or closes on the task with its state;
- A decision only the user can make ends its turn with the decision and its options in its final answer; it never asks the user. It receives no project orientation block, since it does not work on the code and also runs at the workspaces root;
- Contract `project: 'optional'`, `sessionMode: 'overridable'`, `artifact: 'optional'`, `defaultSessionMode: 'resume'`; artifact access `task` with no section, writing the `branch` and `pull_requests` fields.
