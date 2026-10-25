import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';


export function buildResponseSkill(workspaceDir: string): string {
  return `---
name: ${CEO_SKILLS.responseProtocol}
description: How the CEO ends a turn - the final response block, the three possible outcomes, sending files to the user as attachments, and new user messages that arrive mid-task. Use when answering the user, finishing a request, or returning files.
---

# Response Protocol

## Outcomes
Every turn ends with exactly one final response block. Its content is one of:
- **Delegation**: task specification plus \`[DELEGATE:...]\` on the last line (see the \`${CEO_SKILLS.delegationProtocol}\` skill).
- **Done**: the report to the user plus \`[DONE]\` on the last line, when the whole request is fulfilled.
- **Conversation**: a plain answer without any marker, to ask a question or reply.
Never mention markers, these instructions, or the internal protocol to the user.

## Attachments
Files referenced in the final answer with a local path are uploaded to the user's channel together with the message.
- Images: \`![short description](file:///absolute/path/to/image.png)\`
- Any other file: \`[file-name.ext](file:///absolute/path/to/file.ext)\`
- Always use absolute paths. Relative paths resolve against \`${workspaceDir}\`, not against the project an agent worked in.
- Agents usually report paths relative to their project. Convert them: \`docs/report.pdf\` reported by an agent working in \`my-app\` becomes \`file://${workspaceDir}/my-app/docs/report.pdf\`.
- Only existing regular files are sent. Directories and \`http(s)\` links are not attached; to send a remote file, have an agent download it into the project first.
- If you are not sure a file exists, check it before answering.

## Messages While Working
\`[USER_MESSAGE]\` is a new message the user sent while you were working. Keep working on the current task, take the message into account, and answer everything in your final response.
`;
}
