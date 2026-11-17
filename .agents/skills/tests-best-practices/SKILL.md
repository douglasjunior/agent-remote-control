---
name: tests-best-practices
description: >
  Rules for automated tests with Rstest and the NestJS Testing Module. Covers the
  golden rule of rs.mock only for external I/O boundaries, creating stubs and
  fakes that implement ports with factory functions, replacing providers by Symbol,
  observable-effect assertions, determinism (no setTimeout or setImmediate in
  specs: waitFor, act and fake timers instead) and the 100% coverage target. Use
  when creating, modifying or reviewing *.spec.ts files.
---

# Automated testing best practices

> **Maintaining this skill**
>
> Update this document whenever **any rule described here** changes. The criterion is not
> *which* rule — it is the nature of the change: a testing guideline or convention changed →
> update; a technical refactor that preserves the described practice → leave it alone.

This guideline governs all of the application's automated tests, run via Rstest
and integrated with the NestJS testing module (`@nestjs/testing`).

## Stack and commands

- **Framework**: Rstest with `globals: true`; specs import `rs`, `describe`, `it` and `expect` from `@rstest/core`.
- **Environment**: plain Node.js (`testEnvironment: 'node'`).
- **File location**: `*.spec.ts` placed **side by side** with the corresponding
  production file in `packages/server/src/`.
- **E2E tests**: located in the `test/` directory and run with `rstest.config.e2e.ts`.
- **Logs**: a run prints only the results. `test/testing-module.ts` of the server and the p2p-server gives the logger
  of the run, silent by default and every level with `TEST_LOGS=true pnpm test`; `test/setup.ts` installs it for every
  `Logger`, and `createTestingModule` from the same file passes it to the testing module, whose `compile()` would
  otherwise install Nest's logger that prints errors. Assert on a log by spying on `Logger.prototype`, which still
  receives every call.
- **Commands**:
  - `pnpm test`: Runs all unit tests once;
  - `pnpm test:cov`: Runs the tests and generates a code coverage report;
  - `pnpm test:e2e`: Runs the end-to-end tests.

## Golden rule: `rs.mock` only for external boundaries

**Internal project dependencies (any file located in `packages/server/src/`) must never be
mocked using `rs.mock`.**

- **Allowed with `rs.mock`**:
  - Native Node platform modules: `node:fs`, `node:child_process`, `node:crypto`, etc.
  - Third-party SDKs and external network clients that perform real I/O (e.g. `@modelcontextprotocol/sdk`,
    the Discord.js client or external protocol libraries).
- **Forbidden with `rs.mock`**:
  - Any project port (`*.port.ts`), adapter (`*.adapter.ts`), use case (`*.use-case.ts`),
    service (`*.service.ts`) or controller/handler.

### Writing `rs.mock` factories

- Factories are synchronous: Rstest rejects an `async` factory. To keep part of the real module, import it with
  `import * as actualFs from 'node:fs/promises' with { rstest: 'importActual' };` and spread it into the factory's
  return value.
- A factory runs when the mocked module is first imported, so it may only use bindings from modules imported
  before that one. The ACP adapter specs import the factories of `agent/testing/acp-adapter-test-harness.ts`
  statically and mock only `node:stream` and `@agentclientprotocol/sdk`, which the harness itself does not import.

### Why stubs and fakes over `rs.mock`?

Mocking internal modules couples the tests to the file's import structure and hides contract
breaks: if a method signature on a port changes, the mock keeps passing
silently while the real code breaks in production.

With **typed stubs that implement the port interface (`implements IMyPort`)**,
any contract change breaks the TypeScript build immediately, giving
reliable, instant feedback.

## Stub pattern and injection with NestJS

### Implementing the port interface (`implements`)

Create stub classes that implement every method defined in the port interface. Expose
public fields to configure simulated return values and record invocations:

```typescript
import { IAgentClientPort, AgentSessionData } from '../ports/agent-client.port.ts';

export class StubAgentClientPort implements IAgentClientPort {
  connected = false;
  sessions: AgentSessionData[] = [];
  throwOnConnect = false;

  async connect(): Promise<void> {
    if (this.throwOnConnect) {
      throw new Error('Connection refused');
    }
    this.connected = true;
  }

  async createSession(cwd: string): Promise<string> {
    const session: AgentSessionData = { sessionId: 'mock-session-id', cwd };
    this.sessions.push(session);
    return session.sessionId;
  }
}
```

### Stub factory with overrides (`createStub*`)

To simplify writing tests without duplicating code, standardize factories that return a
default stub with neutral (no-op) behavior and allow overriding only the methods
relevant to the specific test:

```typescript
export function createStubAgentClient(
  overrides?: Partial<IAgentClientPort>,
): IAgentClientPort {
  return {
    connect: rs.fn().mockResolvedValue(undefined),
    createSession: rs.fn().mockResolvedValue('default-session-id'),
    closeSession: rs.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

### Dependency injection in a testing module

Build testing modules with `createTestingModule` from `test/testing-module.ts`, never `Test.createTestingModule`
directly, so they keep the logger of the run. Replace the concrete implementation by binding the
port's `Symbol` to the corresponding stub:

```typescript
import type { TestingModule } from '@nestjs/testing';

import { createTestingModule } from '../../../../test/testing-module.js';
import { ConnectAgentUseCase } from './connect-agent.use-case.ts';
import { IAgentClientPort } from '../ports/agent-client.port.ts';
import { StubAgentClientPort } from '../testing/agent-client.stub.ts';

describe('ConnectAgentUseCase', () => {
  let useCase: ConnectAgentUseCase;
  let stubAgentClient: StubAgentClientPort;

  beforeEach(async () => {
    stubAgentClient = new StubAgentClientPort();

    const module: TestingModule = await createTestingModule({
      providers: [
        ConnectAgentUseCase,
        {
          provide: IAgentClientPort,
          useValue: stubAgentClient,
        },
      ],
    }).compile();

    useCase = module.get<ConnectAgentUseCase>(ConnectAgentUseCase);
  });

  it('should connect to agent client and return active status', async () => {
    const result = await useCase.execute({ targetUri: 'localhost:8080' });

    expect(result.isConnected).toBe(true);
    expect(stubAgentClient.connected).toBe(true);
  });
});
```

For pure unit tests that do not need the NestJS container, instantiate the
Use Case class directly, passing the stub to the constructor:

```typescript
const stubAgentClient = new StubAgentClientPort();
const sut = new ConnectAgentUseCase(stubAgentClient);
```

## Assertions: observable effect over implementation spying

Prefer validating the **observable result** and the state changes caused by the system under
test over merely checking internal method calls:

Correct — validates the operation's final effect:

```typescript
const output = await useCase.execute(input);

expect(output.sessionId).toBe('session-123');
expect(stubPort.sessions).toContainEqual(expect.objectContaining({ sessionId: 'session-123' }));
```

Avoid — validation coupled to an internal invocation detail:

```typescript
expect(stubPort.createSession).toHaveBeenCalledWith('/workspace/repo');
```

Use spies (`toHaveBeenCalledWith`) only when the interaction with the external boundary
itself is the primary functional contract (e.g. validating that a critical notification
was dispatched to the Discord channel with the correct parameters).

### Using specific matchers

Prefer explicit matchers to produce clear diagnostics on failure:

- `toHaveLength(n)` over `expect(array.length).toBe(n)`;
- `toBeNull()` and `toBeUndefined()` over `toBe(null)` / `toBe(undefined)`;
- `toContainEqual(...)` for collections of objects;
- `toThrowError(...)` or `rejects.toThrow(...)` for error validation.

## Determinism and time handling

Automated tests are deterministic and independent of the machine's speed. A test never waits for a duration: it
waits for a condition, or it controls the clock.

`setTimeout` and `setImmediate` are not used in a spec, whether as a pause (`setTimeout(resolve, 50)`) or as a
"flush" that lets pending work finish (`new Promise(resolve => setImmediate(resolve))`). A fixed pause is too short
on a busy machine and wastes time on a fast one, and a flush only works while the work happens to finish in one
macrotask. Pick the replacement by what the test is waiting for:

| The test waits for | Use |
|---|---|
| A result or state to appear | `rs.waitFor(() => expect(...))` on that result. In a spec that renders React, `waitFor` and `findBy*` from Testing Library, and `act` around the event that changes state (see the `web-app` skill, `references/testing.md`). |
| A timer of the code under test (timeout, retry, debounce, heartbeat) | `rs.useFakeTimers()` and `await rs.advanceTimersByTimeAsync(ms)`. |
| Something that must **not** happen (no reconnection, no publication, no unhandled rejection) | Fake timers and `await rs.advanceTimersByTimeAsync(0)`, or past the delay the code would wait: `waitFor` would pass on its first check without proving anything. |
| Work the code defers with `setImmediate` | `rs.useFakeTimers({ toFake: ['setImmediate'] })` and `await rs.advanceTimersByTimeAsync(0)`. |
| Two calls to overlap in a certain order | A promise the test releases (`let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; })`) after `rs.waitFor` sees the first call start. |
| A fake or stub to react later | A deferred promise or an event the stub emits, never a delay inside the stub. |

- Fake timers fake only what the test needs (`toFake: ['setTimeout', 'clearTimeout']`, `['setInterval', 'clearInterval']`,
  `['Date']`, `['setImmediate']`), and every spec that turns them on restores them with `rs.useRealTimers()` in `afterEach`,
  or in the test itself when only that test uses them, so a failing test does not leave them on for the next one.
- A spec that fakes `setTimeout` cannot also use `rs.waitFor`, which polls on `setTimeout`: it waits for the
  condition before turning the fake timers on, or it advances the clock itself.
- `testTimeout` is not raised to hide a slow or badly awaited test. A test that needs more than the default is
  waiting on the wrong thing.

## Coverage targets

The operational target is **100% coverage of executable lines** of production code.

For each use case, adapter or service, ensure tests for:
1. The happy path;
2. Expected validations and rejections (specific exceptions thrown);
3. Edge cases (empty collections, boundary values, timeouts);
4. Every conditional branch (`if/else`, `??` and `||` operators).

## Style conventions

- Tests written in English (`describe('ClassName')`, `it('should ...', async () => ...)`).
- Every test name (`it`, `it.each`, `it.skip`, …) starts with `should` followed by the expected behavior, with every
  verb in its base form: `it('should keep the draft and send it on Enter')`, never `it('keeps the draft and sends it')`.
  The `no-restricted-syntax` rule for spec files in `eslint.config.js` enforces the prefix.
- Clear Arrange-Act-Assert (AAA) structure in each test scenario.
- Prefix stubs with `Stub*` or `Fake*`.
- Isolate state: no test may depend on another's result; ensure data is reset
  in `beforeEach`.
- **No barrel exports**: Tests must import classes, interfaces, symbols and stubs directly from the source file where they are defined, without using `index.ts` files.

## Checklist

- [ ] No `rs.mock` pointing to files in `packages/server/src/`.
- [ ] Stubs explicitly implement the port interfaces (`implements I...Port`).
- [ ] Replacement in the NestJS container done through the port's `Symbol`.
- [ ] Direct imports from source files, without barrel exports (`index.ts`).
- [ ] Assertions check state and observable effects before checking method calls.
- [ ] No `setTimeout` or `setImmediate` in a spec: conditions are awaited with `rs.waitFor`, timers are controlled with fake timers and restored in `afterEach`.
- [ ] No `testTimeout` raised to make a test pass.
- [ ] All branches and error handling covered by the spec.
- [ ] Mandatory validation run with `pnpm lint` and `pnpm test` (and `pnpm test:e2e`).
