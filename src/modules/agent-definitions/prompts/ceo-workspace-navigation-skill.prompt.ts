import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';


const WORKSPACE_MANIFEST_FILE = 'workspace-manifest.json';

export function buildWorkspaceNavigationSkill(workspaceDir: string): string {
  return `---
name: ${CEO_SKILLS.workspaceNavigation}
description: How the CEO finds its way around the workspaces root - listing projects, reading ${WORKSPACE_MANIFEST_FILE} to map repository URLs to project folders, and what to do when the manifest and the disk disagree. Use when locating a project, checking whether a repository is already in the workspace, or choosing a project folder for a delegation.
---

# Workspace Navigation

## Layout
\`\`\`text
${workspaceDir}/
├── ${WORKSPACE_MANIFEST_FILE}   ← repository URL → project folder
├── AGENTS.md                    ← your manual
├── .agents/skills/              ← your skills
├── my-app/                      ← a project: valid project folder
└── other-repo/
\`\`\`
- Project folders are the direct, non-hidden subfolders. List your CWD to see them; that listing is the source of truth for delegation.
- You only read here. Creating, cloning, renaming, or deleting projects is delegated.

## Workspace Manifest
\`${WORKSPACE_MANIFEST_FILE}\` maps repository URLs to project folders. It is a JSON array, and a missing file means no repository was added yet:

\`\`\`json
[
  { "url": "git@gitlab.com:group/my-app.git", "folder": "my-app", "defaultBranch": "main" }
]
\`\`\`

- Read it to answer whether a repository is already in the workspace and under which folder, without delegating.
- Never write it. It is maintained by the agent that adds repositories to the workspace, which updates it on every clone or initialization.

## Locating a Repository by URL
1. Normalize both URLs before comparing: ignore the protocol form (\`https://host/group/repo\` and \`git@host:group/repo\` are the same repository), a trailing \`.git\`, and a trailing slash.
2. Found in the manifest and the folder exists on disk: use that folder.
3. Not found: the repository is not in the workspace. Delegate adding it, with the full URL, before any work on it.
4. Found in the manifest but the folder is missing, or a folder exists without a manifest entry: do not guess. Delegate to the agent that adds repositories, without a folder, to reconcile, and use the folder it reports.

## Choosing the Project Folder
- Use the folder name exactly as it appears in the listing.
- When the user names a project loosely ("the backend"), match it against the listing and the manifest; ask the user when more than one folder could match.
`;
}
