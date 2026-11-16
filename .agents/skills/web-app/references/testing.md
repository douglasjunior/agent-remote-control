# Testing React components and hooks

> **Maintaining this reference**
>
> Update it whenever a rule for testing components or hooks in `packages/web` changes: how state updates are
> synchronized, how interactions are simulated, how asynchronous results and timers are awaited.

Every React state update in a spec happens inside `act`. An update outside it makes React print "An update to X
inside a test was not wrapped in act(...)": the spec may still pass, but it asserted before React committed, and the
output hides real failures. A spec run prints no such warning.

## Interacting like the user

- Drive components with `user-event` (`const user = userEvent.setup()`, then `await user.click(...)`,
  `user.keyboard(...)`, `user.pointer(...)`, `user.clear(...)`). It focuses what it clicks, sends every key event and
  keeps the selection, as a browser does, and runs inside `act`.
- `fireEvent.*` sends one bare event: no focus, no key events around a change, no selection. React's own tracking
  (its `onSelect`, for one) then sees a state a user never produces. Keep `fireEvent` for events `user-event` does
  not simulate, such as a drop with a `dataTransfer` or a file input change.
- A spec harness honors the contract of the hook it hosts: `useFileMentions` moves the caret "once the new text
  reaches the field", so its harness applies the caret in a `useLayoutEffect`, like `usePromptInput`.

## Synchronizing updates

- **Events from a fake** (`FakeServerConnection.emitEvent`, a stub calling back): wrap the call in
  `act(() => ...)` when the event only changes state, and in `await act(async () => { ... })` when it settles a
  promise the component awaits (a request answered, an upload finished). The code after that `await` runs in a later
  microtask, past the end of a synchronous `act`. `answer` in `src/test/artifact-fixtures.ts` and `completeUpload` in
  `conversation-view.spec.tsx` follow this.
- **Hooks**: `renderHook`, with `act(() => result.current.action())` for a synchronous change and
  `await act(async () => { ... })` for an action that returns a promise.

## Awaiting asynchronous results

- Wait with `waitFor` and `findBy*` from `@testing-library/react`, never `rs.waitFor`: Testing Library turns off
  React's act environment while it polls, so updates that land during the wait are expected; `rs.waitFor` does not,
  and every update it lets through warns. `rs.waitFor` stays for specs that render no React, such as the connection
  classes.
- A debounce or delay is awaited by its effect, on real timers: `waitFor` until the request goes out
  (`searched(query)` in `use-file-mentions.spec.tsx`). Never a bare `setTimeout` to let things settle.

## Fake timers

- `user-event`, `waitFor` and `findBy*` wait on `setTimeout` and only advance Jest's fake timers: under
  `rs.useFakeTimers()` with `setTimeout` faked they hang until the test times out. A spec that interacts or waits
  keeps `setTimeout` real.
- Fake only the clock the code under test reads: `rs.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })`
  for a label refreshed by `useNow`, and advance it with `act(() => rs.advanceTimersByTime(ms))`.
- Do not use `shouldAdvanceTime: true`: the clock then moves with real time, timers fire whenever the machine gets
  to them, outside `act`, and the warnings come and go between runs.
- A spec that raises a toast dismisses it inside `act` in `afterEach`, as `artifact-unfreeze.spec.tsx` does: a toast
  left open keeps its own timers.

## Finding the source of a warning

React names the component but not the line. To find it, temporarily wrap `console.error` in `src/test/setup.ts`, print
`new Error().stack` (after `Error.stackTraceLimit = 80`) when the message contains `not wrapped in act`, and run the
one spec. The frames below the component's handler point at the event or promise that escaped `act`.
