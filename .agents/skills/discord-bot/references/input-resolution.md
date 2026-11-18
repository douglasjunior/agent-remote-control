# Input Resolution and Agent and Model Selection

Discord owns its conversation dialogs: the numbered menus, their state, the pending language request, the agent login
dialog and the reading of typed numbers live in `modules/discord`, and the orchestrator knows none of them.

## `DiscordConversationService`

The handlers' entry point: `resolveInput`, `startAgentSelection`, `startConfigSelection`, `startProfilesSelection`,
`cancelConfigSelection`, `hasActiveConfigSelection`, `requestLanguageChange`, `hasPendingLanguageChange`,
`cancelLanguageChange`, `startAgentAuthSelection`, `startAgentLogin`, `hasPendingAgentAuth` and `cancelAgentAuth`.

It composes `ResolveConversationInputUseCase`, `StartAgentConfigSelectionUseCase`, `SubmitAgentConfigSelectionUseCase`,
`CancelAgentConfigSelectionUseCase`, `AgentProfileListService` (builds the profile step), `LanguageChangeRequestService`,
`AgentAuthRequestService`, `DiscordAgentAuthNotifierService` and the in-memory `IAgentConfigSelectionStorePort` (a
selection interrupted by a restart is discarded) on top of the orchestrator ports only (`IAgentConfigurationPort`,
`IAgentTurnPort`, `IUserQuestionPort`, `ITurnRetryPort`) and `IAgentAuthPort`; specs use their stubs from `orchestrator/testing/`.

Menu models (`AgentConfigSelection`, `SelectionOption` with its 1-based `index`, and the resolution outcomes) are
Discord models; `toSelectionOptions` numbers the orchestrator's `AgentOption`s.

## `resolveInput`

Before running the turn, the handler validates and downloads the attachments and calls
`DiscordConversationService.resolveInput({ conversationId, prompt, attachments? })` with the message text (empty when it
carries only attachments) inside `DiscordTypingIndicator.during(channel, ...)`, because answering a selection lists
models or efforts through a disposable agent and takes a few seconds.

The use case takes the text as typed and the attachments as downloaded, and decides what the message is, in this order:

1. the answer to the open question (`IUserQuestionPort.answerQuestion`): a whole number becomes `{ kind: 'option' }`
   when the question has options, any other text becomes `{ kind: 'text' }`, the attachments going with either;
2. the language, when a request is pending;
3. the code a running agent login waits for (`AgentAuthRequestService.loginAwaitingCode`);
4. the pick of an agent to log in (digits `1..N`, `0` to cancel) while one is pending;
5. the answer to an open selection (digits `1..N`, comma-separated at the profile step, `0` to exit or go back);
6. the request to retry a failed turn now, while one waits (`ITurnRetryPort.retryNow` with the text and the attachments);
7. a prompt to run.

Without settings for the conversation it inherits the most recent ones (`IAgentConfigurationPort.ensureSettings`); with
none ever saved it opens the `agent` selection with the message (`PendingMessage`: the text as typed and its
attachments) kept in the selection, and runs it with those attachments once the selection is configured
(`unavailable` becomes `execute`).

## Outcomes

- `retry_requested`: sends `formatRetryRequested` and stops;
- `question`: sends `formatQuestion` with the next question and stops;
- `invalid_answer`: sends `formatInvalidAnswer` (valid range followed by the question) and stops;
- `answered`: sends `formatAnswersSent` and, when another agent is waiting, `formatQuestion` with its question, and stops;
- `selection` and `profiles_menu`: sends `formatSelection` (numbered list of agents, models, efforts or profiles) and stops;
- `profiles_updated`: sends `formatProfilesUpdated(updatedRoles, profile)` followed by the refreshed `formatSelection` and stops;
- `profiles_closed`: sends `formatProfilesClosed` and stops;
- `language_set`: sends `✅ **Language saved**: <language>`; `invalid_language`: sends `⚠️ Invalid language. ...` while the request stays open;
- `agent_auth_selected`: `DiscordConversationService.startAgentLogin` starts the login of the picked agent and stops;
- `invalid_agent_auth_choice`: sends `formatInvalidAgentAuthChoice(count)` and stops; `agent_auth_closed`: sends `formatAgentAuthClosed` and stops;
- `agent_auth_code`: the text went to the login's stdin (`IAgentAuthPort.submitInput`). The handler deletes the user's
  message, because it carries a credential, and sends `formatAgentLoginCodeReceived`, or `formatAgentLoginCodeRejected`
  when the login no longer takes input. While an agent login dialog is open the `[Message Received]` log line hides the text;
- `invalid`: sends `formatInvalidSelection` (valid range followed by the list) and stops;
- `configured`: sends `formatConfigured` and stops;
- `execute`: if it carries `configured`, sends the confirmation and runs the resolved `prompt` (the pending prompt of the first message).

## Selection steps

The selection starts on its own with the first message while there is no saved configuration, and is reopened with
`/agent` (starting from the agent), `/model` (model and effort of the current agent) or `/profiles` (profile list).
`/agent` and `/model` overwrite every profile. The state is per conversation (channel + thread).

The `formatSelection` header depends on the step (`AgentConfigSelection.step`):

- `profile`: `👥 **Choose the profiles to configure** — type numbers separated by commas, or 0 to exit:`;
- `agent`: `🤖 **Choose the agent** by replying with the option number:`;
- `model`: `🧠 **Choose the <selectedAgent.name> model** by replying with the option number:`,
  or `🧠 **Choose the agent model** ...` without `selectedAgent`;
- `effort`: `⚡ **Choose the effort for <selectedModel.name>** by replying with the option number:`.

The agent, model and effort steps of a selection with `targetRoles` add `Type 0 to go back to the profile list.` to the header.

`formatConfigured(settings)` confirms, for every profile written by `/agent`, `/model` and the first-message selection,
the CEO profile (or the first profile when none is the CEO) with
`✅ **Settings saved for all profiles**: 🤖 <agentName> · 🧠 <modelName> · ⚡ <effortName>`, with `default` when the
model or the effort is null, and only `✅ **Settings saved for all profiles**` when there is no profile.
`formatProfilesUpdated` confirms `✅ **Profiles updated** (<roles>): 🤖 ... · 🧠 ... · ⚡ ...` and `formatProfilesClosed`
replies `✅ **Profile configuration closed.**`.
