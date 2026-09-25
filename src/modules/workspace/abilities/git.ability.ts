export const GIT_ABILITY = `### Git Version Control & Commit Conventions

Repositories are cloned and maintained inside the workspace directory.

When interacting with Git repositories, follow these rules:

1. Commit Message Convention:
   - Strictly follow the Conventional Commits format in Portuguese (pt-BR):
     <tipo>: <assunto>
   - Valid types: feat, fix, docs, style, refactor, test, chore.
   - The subject must be written in pt-BR, using the verb in the present indicative tense (e.g. "adiciona suporte", "corrige falha", "implementa endpoint", "remove modulo").
   - Maximum subject length is 50 characters.
   - Do not put a period at the end of the subject.
   - When detailed context is needed, separate the body from the subject with a single blank line.

2. Safety and Verification Rules:
   - Never use force push (e.g., git push --force, -f).
   - Inspect git status and git diff before staging or committing changes.
   - Never commit sensitive information, credentials, private keys, or .env files.
   - Never commit broken code; verify that tests pass before committing.
   - Keep commits atomic, cohesive, and focused on a single change.`;
