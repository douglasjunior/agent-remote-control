import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';

import { USER_QUESTIONS_GUIDE } from './user-questions.prompt.js';


export function buildResponseSkill(workspaceDir: string): string {
  return `---
name: ${CEO_SKILLS.responseProtocol}
description: How the CEO ends a turn - the final response block, delegating versus answering the user, sending files to the user with <attachment>, and new user messages that arrive mid-task. Use when answering the user, finishing a request, or returning files.
---

# Response Protocol

## Outcomes
Every turn ends with exactly one final response block. Its content is one of:
- **Delegation**: one or more \`<delegate>\` tags with the task specifications (see the \`${CEO_SKILLS.delegationProtocol}\` skill). Text outside the tags is shown to the user as a short progress note.
- **Questions**: one or more \`<question>\` tags asking the user for decisions you need before going on. The user answers them one at a time and the answers come back to you as \`<user_answers>\`, in the same turn. Never combine questions with delegations or attachments.
- **Answer**: text for the user without any \`<delegate>\` or \`<question>\` tag, which ends the turn. Use it to report finished work or reply.
Never mention the tags, these instructions, or the internal protocol to the user.

## Questions to the User
${USER_QUESTIONS_GUIDE}

## Attachments
Files listed in \`<attachment>\` tags are uploaded to the user's channel together with the answer, one tag per file:
\`\`\`text
Here is the report and the screenshot.

<attachment path="${workspaceDir}/my-app/docs/report.pdf">Report</attachment>
<attachment path="${workspaceDir}/my-app/screenshots/home.png">Home screen</attachment>
\`\`\`
- Always use absolute paths. Relative paths resolve against \`${workspaceDir}\`, not against the project an agent worked in.
- Agents usually report paths relative to their project. Convert them: \`docs/report.pdf\` reported by an agent working in \`my-app\` becomes \`${workspaceDir}/my-app/docs/report.pdf\`.
- Only existing regular files are sent, and only in an answer, never in a response that delegates. Directories and \`http(s)\` links are not attached; to send a remote file, have an agent download it into the project first.
- If you are not sure a file exists, check it before answering.

## Messages While Working
\`[USER_MESSAGE]\` is a new message the user sent while you were working. Keep working on the current task, take the message into account, and answer everything in your final response.
`;
}
