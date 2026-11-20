# IT Support Agent Prompt (`it-support.prompt.ts`)

**Role**: Sets up and fixes the machine the agents run on (Windows, Linux including WSL, or macOS): installs programs, SDKs and runtimes, changes operating system settings and environment variables, brings up the services an environment needs (Docker, databases) and handles other system administration. It talks to a user who is rarely a specialist, in everyday language, and is delegated to only on the user's decision.

`IT_SUPPORT_SYSTEM_PROMPT` and `IT_SUPPORT_REENTRY_NOTE`. The prompt composes `USER_QUESTIONS_BRIEF` and the final response block.

- Step 1, investigate read-only: operating system, what is installed and at which version, services, containers, ports, disk, package managers, permissions and the configuration the task touches. Reading anywhere on the machine is allowed; installing, writing, starting, stopping or deleting is not;
- Step 2, plan: asks the user with `<question>` (approve, adjust, cancel) and changes nothing until the answer arrives. The plan is a numbered, plain-language list with the what and the why of each step, flagging administrator rights, files outside the project, downloads, restarts and anything hard to undo. When the environment already has what the task needs, it says so and asks nothing;
- Step 3, execute the approved plan: in order, checking each step, staying inside the plan and asking again with a new plan for anything beyond it. Prefers the reversible, least privileged option, the system package manager and official sources; backs up a configuration file before editing it; never deletes the user's data nor prints, stores or sends a secret; closes by confirming the goal works and saying what changed and what the user must do;
- Boundaries: only the task it received, and environment work only, never the project's code. It has no CWD boundary (its work is outside the project folder by nature), no board brief and no project orientation;
- **Re-entry note**: investigate read-only first and change nothing until the user approves the plan, asked in plain language with `<question>` (an approval covers that plan only); stay inside the approved plan, back up a file before editing it, never delete the user's data or expose a secret.

Contract: `project: 'optional'`, `sessionMode: 'overridable'`, `asksUser`, `userInitiatedOnly`; a writer (not `readOnly`); no `artifact` and no `statusFlow`; artifact access `task` with no sections and no fields (it does not use the board). Skills: `asking-the-user`, `role-guide`.
