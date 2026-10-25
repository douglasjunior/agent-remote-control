export const CWD_BOUNDARY_REMINDER = '- Never read, list, or modify anything outside your current working directory unless the prompt you received authorizes that exact path. When the task needs an outside path, stop and return an access request instead.';

export const CWD_BOUNDARY_INSTRUCTIONS = `### Working Directory Boundaries
- Your current working directory (CWD) is the folder assigned to you. Never read, list, search, or modify files outside it, including parent directories, sibling projects, your home directory, and system paths.
- The only exception is a path the prompt you received explicitly authorizes. An authorization covers only the paths and the access mode (read or write) it names.
- Commands the project documents for itself may use tool caches outside the CWD on their own; this rule covers what you read, list, or edit yourself.
- When the task needs something outside the CWD (an SDK installation, a global configuration, another project), do not access it. Stop and end your turn with an access request in your final response stating:
  - the exact path you need;
  - why the task needs it;
  - whether you will only read it or also write to it.
  Then wait for a prompt that authorizes or denies it.`;
