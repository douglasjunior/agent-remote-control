# Turn Message Formats

The text `DiscordActivityFormatter` produces for what a turn posts: agent questions, activities, delegation, the
response footer and each turn outcome.

## Agent questions

- **`formatQuestion(prompt)`**: the agent's free text (only on the first question), followed by
  `❓ **Question <n>/<total>** · <roleName> (\`<project>\`)`, the question text in bold, the `rationale` in italics after
  "Why it matters:", the numbered options (`**1.** ...`) with the recommended one marked `_(recommended)_`, and a `-#`
  line explaining that one answers with the number or with other text and that `/cancel` interrupts everything. While
  the timeout is enabled it adds `-# ⏱️ Without a reply <t:<unix>:R>, ...` with a Discord relative timestamp. With other
  agents in the queue, it appends `-# ⏳ <n> more agent(s) waiting for answers after this one.`
- **`formatInvalidAnswer(prompt)`**: `⚠️ Invalid option. Reply with a number from 1 to <N> or type another answer.`
  followed by the question, without the agent's free text.
- **`formatAnswersSent(asker)`**: `✅ Answers sent to **<roleName>** (\`<project>\`).`
- **`formatQuestionTimedOut(event)`**:
  `⏱️ **No reply in <n> min** · <roleName> (\`<project>\`) — assumed the recommended answer **<n>. <option>**`, or
  `no answer assumed, the agent decides how to proceed`, plus the question in a `-#` line.

## Activities

- **Thoughts (`thought`)**: delivered in full (no 5-line limit), formatted as a Discord quote block with emoji
  (`> 💭 *<text>*`), split into blocks of up to 2,000 characters via `splitMessage`. Real-time updates replace or edit
  existing messages through `DiscordThrottler` (1,500ms interval against 429 rate limits).
- **Tools (`tool`)**: each tool call generates individual messages in the thread:
  - at start (`in_progress`): sends `⏳ **Running**: \`<title>\``;
  - on completion (`completed` or `failed`): edits that same message to `✅ **Completed**: \`<title>\`` or
    `❌ **Failed**: \`<title>\``, with a code block of up to 5 lines of details (arguments or output). More than 5 lines
    shows the first 5 followed by `... (+N lines)`.
- **Skills (`skill`)**: each skill an agent reads or writes posts one message right away, outside the throttler (which
  keeps only the latest action): `📘 **<ROLE>** read the skill \`<name>\``,
  `📝 **<ROLE>** created|updated the skill \`<name>\``, or
  `⚠️ **<ROLE>** could not read|write the skill \`<name>\` — <error>` (the error cut at 200 characters).
- **Transcripts**: `formatTranscripts` echoes each audio transcript as `🎙️ **<file>**` followed by the quoted text;
  transcription warnings are sent as they are.

## Delegation and interim messages

- **`formatDelegation(event)`**: on `started`, the notice says which agent took over, with name and role (e.g.
  `DEVELOPER`), the project and the artifact it holds (``on `T-3` ``); on `finished`, the notice says the CEO is
  reviewing. `cancelled` announces nothing, because the turn's own result reports the cancellation.
- **`formatDelegateResult(event)`**: the delegate's response on `finished`, naming the project to distinguish parallel
  delegations of the same role, with the footer `formatDelegateFooter(event)` (the same as `formatAgentFooter` with the
  delegate's agent, model, effort and tokens, plus `· ⏱️ <duration>`), split like final responses.
- **CEO interim message**: the text the CEO wrote outside the tags in a response that delegates, split like final
  responses and with no footer.

## Response footer and outcomes

Every turn outcome with `TurnResult.agentInfo` gets the footer `formatAgentFooter(info, usage?)`:
`-# 🤖 <role> (<agent>) · 🧠 <model> · ⚡ <effort>`, with `default` when the model or the effort is not known. With
`TurnResult.usage`, the footer ends with `· 🪙 <total> tokens`, abbreviated as `k`/`M`.

- **Completed**: the text is the response; with no text, `✅ *Task completed with no response message.*`.
- **Cancelled**: `⚠️ **Turn cancelled by the user.**`.
- **Steered** (`status: 'steered'`):
  `📨 *Message sent to the running agent. The reply will come with the current task's response.*`, with no footer and
  no splitting.
- **Failure**: `❌ **Execution error**: <errorMessage>`.
- **Exception while processing the message**: `❌ **An error occurred while processing your request:** <message>`,
  also split.
- **Queued** (`onQueued`): the progress message shows
  `⏳ *Waiting for the previous task in this conversation to finish...*`.
