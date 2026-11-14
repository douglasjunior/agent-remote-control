# Agent logins

## Popover

`AgentAuthController` (`components/auth/`) sits in the header and renders `AgentAuthPopover`: a key button, with a red dot while an agent needs a login, opening one row per agent with the name, account detail, a "Logged in", "Not logged in" or "Unknown" badge and an "Authenticate" or "Re-authenticate" button.

## State

`useAgentAuthStatus` holds the state outside the conversations reducer, which passes `auth.status`, `auth.status.failed` and `auth.login` through unchanged.

- It sends `auth.status` when the status becomes `open`, every `AUTH_REFRESH_MS` (5 minutes) while the tab is visible, and on returning to the tab when the answer is that old.
- It keeps the agents (`null` until the first answer; `auth.status.failed` keeps the last answer) and a login state per agent: `idle`, `starting`, `waiting` (link and optional one-time code), `prompt` (the CLI waits for a code pasted from the browser), `verifying` or `failed` (reason).
- `completed` and `cancelled` return to `idle`; `completed` also calls the hook's `onCompleted` and sends `auth.status` with `refresh: true`.
- Actions: `login`, `submitCode` (`auth.input`) and `cancel`.
- After a code is sent the login state is `verifying`: the card shows a spinner with `Checking the code…` and the toast says the same, until `completed`, `failed` or a new `prompt`; a `prompt` that arrives while verifying means the code was not accepted, so the card shows an alert above the input.

## Toasts

- The controller keeps one toast per agent that is not logged in or has a login in progress, with the stable id `auth-<agentId>`, `duration: Infinity` and `dismissible: false`, so it only goes away when the agent is logged in, the login is cancelled or the agent disappears.
- Nothing is shown before the first answer, and an `unknown` agent never gets one.
- The toast text follows the login state: "is not logged in" with an Authenticate action; starting; the link ("Open login page", `target="_blank"`, `rel="noopener noreferrer"`, rendered only for `https:` URLs by `safeLoginUrl`) with the one-time code and its copy button and a Cancel action; for a pasted code, an "Enter code" action that opens the popover; failure with the reason and a Try again action.
- A completed login shows an auto-dismissing success toast.
- The code the browser shows is typed in the popover's `AgentLoginCard`, not in the toast: an input inside a toast that cannot be dismissed loses focus on every toast update. For the same reason a toast carries a single action button (sonner ignores `cancel` on a toast that is not dismissible), so Cancel on the code toast is a button in its description.
