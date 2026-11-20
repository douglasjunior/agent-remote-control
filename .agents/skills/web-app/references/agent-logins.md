# Agent logins

## Where they show

`AgentAuthProvider` (`components/auth/`) wraps the app inside `AppLayout`: it owns the login state and the toasts and offers
them through `useAgentAuth()` (the `useAgentAuthStatus` view plus `needsLogin`, true while an agent is `unauthenticated`).

- The Agents section of the settings hub starts with `AgentLogins`, a "Logins" block: one row per agent with the name,
  account detail, a "Logged in", "Not logged in" or "Unknown" badge and an "Authenticate" or "Re-authenticate" button, and
  under it the `AgentLoginCard` of a login in progress (see [settings-hub.md](settings-hub.md)). It says "Checking the
  agents…" until the first answer and "No agent supports login here." for an empty one.
- The header has no logins control. The settings gear (named "Settings, agent login needed" meanwhile) carries a red dot
  while `needsLogin`.

## State

`useAgentAuthStatus` holds the state outside the conversations reducer, which passes `auth.status`, `auth.status.failed` and `auth.login` through unchanged.

- It sends `auth.status` when the status becomes `open`, every `AUTH_REFRESH_MS` (5 minutes) while the tab is visible, and on returning to the tab when the answer is that old.
- It keeps the agents (`null` until the first answer; `auth.status.failed` keeps the last answer) and a login state per agent: `idle`, `starting`, `waiting` (link and optional one-time code), `prompt` (the CLI waits for a code pasted from the browser), `verifying` or `failed` (reason).
- `completed` and `cancelled` return to `idle`; `completed` also calls the hook's `onCompleted` and sends `auth.status` with `refresh: true`.
- Actions: `login`, `submitCode` (`auth.input`) and `cancel`.
- After a code is sent the login state is `verifying`: the card shows a spinner with `Checking the code…` and the toast says the same, until `completed`, `failed` or a new `prompt`; a `prompt` that arrives while verifying means the code was not accepted, so the card shows an alert above the input.

## Toasts

- The provider keeps one toast per agent that is not logged in or has a login in progress, with the stable id `auth-<agentId>`, `duration: Infinity` and `dismissible: false`, so it only goes away when the agent is logged in, the login is cancelled or the agent disappears.
- Nothing is shown before the first answer, and an `unknown` agent never gets one.
- The toast text follows the login state: "is not logged in" with an Authenticate action; starting; the link ("Open login page", `target="_blank"`, `rel="noopener noreferrer"`, rendered only for `https:` URLs by `safeLoginUrl`) with the one-time code and its copy button and a Cancel action; for a pasted code, an "Enter code" action that navigates to `/settings/agents` (with `returnTo`, as any link into the hub); failure with the reason and a Try again action.
- A completed login shows an auto-dismissing success toast.
- Every toast action goes through `keepToast`, which prevents the click's default: sonner removes a toast 200 ms after an action click otherwise, and the login state, not the click, decides what the toast shows next.
- The code the browser shows is typed in the `AgentLoginCard` of the Agents section, not in the toast: an input inside a toast that cannot be dismissed loses focus on every toast update. For the same reason a toast carries a single action button (sonner ignores `cancel` on a toast that is not dismissible), so Cancel on the code toast is a button in its description.
