# Agent usage

## Indicator

`UsageIndicator` (`components/usage/`) sits in the header next to the connection badge: one vertical meter per agent, in the server's order, each at the agent's closest limit (`tightestFraction`), then the highest percent used in mono (0% untouched, 100% exhausted). An agent without numbers shows an empty track; with no reports yet the tracks pulse and the text is `–`. The accessible name carries the percent. Levels match the Discord `/usage` (`quotaLevel`: `good` from 50%, `attention` from 20%, `critical` below, drawn with `--good`, `--attention` and `--destructive`).

## Panel

A click opens `UsagePanel` in a shadcn `Popover`, built to be read at a glance:

- One line per bucket in columns aligned across the agents under a "Limit, Used, Resets" header, with the label, a thin bar, the percent used and a compact time until the reset (`formatCountdown`; the full sentence is the `title` and the screen reader text), left out once it has passed.
- Color marks what needs attention: a percent stays in the foreground color while `good`, and a `critical` row is tinted.
- `bucketLabel` names a bucket by its window and adds the qualifier from its name when a sibling shares that window (`Week · Sonnet only`).
- A group is named only when the agent has more than one; an agent without numbers takes one line, with "No usage data" or "Could not read usage".
- A row never moves on refresh, because the order is the server's.

## Refresh

`useAgentQuota` holds the numbers outside the conversations reducer, since only this indicator reads them. It sends `quota.get` when the status becomes `open`, every `QUOTA_REFRESH_MS` (5 minutes) while the tab is visible, and on returning to the tab when the numbers are that old; the panel's refresh button sends `refresh: true`. Each query starts the agents' CLIs, so keep this rate low. The last numbers stay on screen through a refresh, a `quota.failed` ("Could not refresh") or a lost connection.
