import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import { WORKSPACE_MANIFEST_FILE } from '../constants/workspace-manifest.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const REPOSITORY_SETUP_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.repositorySetup,
  description: `Adding a repository to the workspace - the ${WORKSPACE_MANIFEST_FILE} that maps repository URLs to project folders, folder naming, cloning over SSH or HTTPS, SSH key setup, and initializing a new repository. Read before the first clone or initialization of a session, and when a clone fails to authenticate.`,
  roles: ['GIT_OPS'],
  buildContent: ({ workspaceDir }) => `# Repository Setup

## Workspace Manifest
\`${workspaceDir}/${WORKSPACE_MANIFEST_FILE}\` maps repository URLs to folder names. You are its only writer; the orchestrator also reads it to locate repositories. It is a JSON array, and an absent file means an empty workspace:

\`\`\`json
[
  { "url": "git@gitlab.com:group/my-app.git", "folder": "my-app", "defaultBranch": "main" }
]
\`\`\`

Read it before cloning: when the URL is already listed, the repository exists and you report its folder instead of cloning again. Write it after every successful clone or initialization, creating it when it does not exist.

## Folder Naming
Derive the folder name from the repository URL: the last path segment without the \`.git\` suffix, so \`git@gitlab.com:group/my-app.git\` becomes \`my-app\`. Keep the rule exact: the caller routes later work by folder name, and a different name creates a second clone of the same repository.

## Choosing the Transport
1. The transport the instruction names (HTTPS, SSH, a provider CLI) is the one to use.
2. Without one, when the provider's CLI is installed and authenticated (\`gh auth status\`, \`glab auth status\`), clone over HTTPS with it: it needs no key setup.
3. Otherwise use SSH, which authenticates without interactive prompts once a key is registered:
   - GitHub: \`https://github.com/<org>/<repo>.git\` becomes \`git@github.com:<org>/<repo>.git\`
   - GitLab: \`https://gitlab.com/<group>/<repo>.git\` becomes \`git@gitlab.com:<group>/<repo>.git\`
   - Azure DevOps: \`https://dev.azure.com/<org>/<project>/_git/<repo>\` becomes \`git@ssh.dev.azure.com:v3/<org>/<project>/<repo>\`

## Cloning
1. Run SSH clones with \`GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"\`, so the first connection to a host does not block waiting for host key confirmation.
2. From the workspaces root, clone into the derived folder name. From inside an assigned empty project folder, clone into it with \`git clone <url> .\`.
3. Record the repository in the manifest, then report the folder name.

## SSH Key Setup
- Before the first SSH clone, check whether \`$HOME/.ssh/id_rsa.pub\` exists.
- When \`$HOME/.ssh/id_rsa\` exists without its \`.pub\` file, regenerate the public key: \`ssh-keygen -y -f "$HOME/.ssh/id_rsa" > "$HOME/.ssh/id_rsa.pub"\`.
- When neither exists, create \`$HOME/.ssh\` with mode 700 and generate an RSA key pair without passphrase: \`ssh-keygen -t rsa -b 4096 -N "" -C "agent-remote-control" -f "$HOME/.ssh/id_rsa"\`.
- An existing key is never overwritten, moved or deleted, and the private key (\`$HOME/.ssh/id_rsa\`) is never printed, copied or transmitted.
- Whenever a key pair was generated, or a clone fails with \`Permission denied (publickey)\`, stop and put the full content of \`$HOME/.ssh/id_rsa.pub\` in a code block in your final answer, asking the user to register it as an SSH key in their Git provider and to confirm when done. When HTTPS through the provider's CLI would work instead, say so as the alternative.

## Initializing a New Repository
When asked to initialize rather than clone, create the folder from the given name, run \`git init\`, and make a single scaffolding commit in the Conventional Commits format in English, subject in the imperative mood and up to 50 characters. Record it in the manifest.
`,
};
