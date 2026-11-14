# Team presentation

**The feed is the history; the right panel is the present moment.** The conversation grows without limit, so the panel never does: it holds one station per role and no per-entry data, and everything that happened lives in the feed.

## Agent identity and mark

- `agentIdentity(role, roleName)` (`lib/agent-identity.ts`) gives each role its `mark` id, plain-language label, tagline, `stage` (Leads, Idea, Plan, Build, Review, Test, Ship; "Helps" for unknown roles), `responsibility`, example request and color token (`--agent-<role>` in `index.css`, light and dark). A role outside the team gets the generic mark and a color derived from its name. A stage is the role's specialty, never progress: the CEO may delegate to any role in any order.
- `AgentMark` (`components/agent/`) is the round lens with a custom SVG glyph per role (`generic` for unknown roles), a done or failed badge, a working glow and a waiting glow in the attention color; its accessible name is `"<label>, <state>"`. The per-glyph keyframes live in `index.css` and run only under `prefers-reduced-motion: no-preference`.

## Team state

`deriveTeam(entries, running)` (`conversations/team-state.ts`) turns the entries into one `TeamMember` per role for the current turn plus the delegations still open from earlier turns:

- A `user_message` drops the closed delegations, because the CEO accepts new messages while delegates keep running; open ones stay `working` while a turn runs and keep counting their steps, other agents count only the current turn.
- A `finished`, `failed` or `cancelled` entry closes the delegation with the same `delegationId`; a cancelled agent is `idle` and its handoff row reads "Stopped", whatever turn runs later. A delegation still open when no turn runs counts as stopped.
- The members are `working`, `waiting` (the asker of the `openQuestion`, by `askerRole`, whatever entries follow it), `done`, `failed` or `idle`, with the CEO's `summary`, project, start time, duration, step count and last action.
- The CEO is `idle`, not `working`, while a delegate works or another agent has an open question. Roles the turn did not involve stay `idle`.

## Squad panel

- `SquadPanel` (`components/squad/`) renders the roster: the seven team roles (CEO, Product Owner, Tech Lead, Developer, Reviewer, QA, Git Ops, in `TEAM_ROLES` order, which `TeamIntro` follows too) plus an unknown role only if it was delegated to in the current turn.
- A `Station` has the mark, name, stage, time, the role's profile from the conversation (`profileSummary`, `lib/role-profile.ts`: "agent · model · effort", "Not configured", and "not installed" for a missing CLI; the settings sheet uses the same summary), a summary clamped to two lines and one ticker line with the latest action.
- The CEO reads "Coordinating the squad" and looks active while delegates work, "Thinking" when it works itself. Selecting a station reveals only its static `responsibility`.
- The header carries the live tally (`squadStatus`), which also labels the Squad tab. The panel scrolls only when the window is shorter than the roster, and resets with each new user message.
- The spine is a neutral line through the lens centers (`useSquadSpine`, positioned from measured lenses) and implies no order. `useSquadMotion` sends light pulses on short-lived elements animated with the Web Animations API: CEO to a working station on an interval, a bigger one when it starts and one back when it ends; each pulse removes itself on finish. Nothing runs under `prefers-reduced-motion` or without `Element.animate`.
- The delivery moment (`useDelivery`) counts a turn seen running here that delegated and ended with a completed answer; the panel then plays its flare and bloom once (`data-delivered`). A conversation opened with its turn already over never plays it.

## Focus

Selecting a station or clicking an agent name in the feed sets the focus in `ConversationView`; it resets with the conversation (the view is keyed by id). The feed dims items of other agents (handled in `FeedItem`: handoffs and activity by role, `agent_response` and `interim` by CEO, `question` by `askerRole`; user messages and notices never dim) and a chip in the chat header, "<Agent> only ×", clears it. Hovering a feed item highlights its station.

## Layout

- `ConversationView` places the chat column (centered, max 680 px) and the 420 px panel side by side; below 820 px of viewport they become two shadcn tabs, both kept mounted.
- Side by side, an `IconButton` in the chat header (next to Settings) collapses and restores the panel (`PanelRightClose`/`PanelRightOpen`, `aria-expanded`, `aria-controls="squad-panel"`, label "Hide squad panel" or "Show squad panel"). The collapsed `aside` stays mounted and `hidden`, so the panel keeps its state; the choice is kept by `useStoredFlag` under `arc.squadPanelOpen`, default open.
- While collapsed, a dot on the toggle and the squad status in its label (`squadNeedsAttention`) show an agent waiting for the user or stopped work. The tabbed layout has no toggle.

## Recap and presence

- The answer that closes a turn that delegated carries "N agents · duration" in its footer (`TeamRecap` from `groupEntries`).
- `usePresence` sets the tab title, tints the page light with the active agent's color and, when the browser already granted permission, notifies a question while the tab is hidden.
- `AmbientGlow` is the light that follows the pointer (`usePointerGlow`: eased `requestAnimationFrame`, off for touch screens and reduced motion).
- An empty conversation shows `TeamIntro`, whose cards fill the composer (`Composer.initialText`).
