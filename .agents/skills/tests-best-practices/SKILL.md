---
name: tests-best-practices
description: >
  Rules for automated tests with Vitest and the NestJS Testing Module. Covers the
  golden rule of vi.mock only for external I/O boundaries, creating stubs and
  fakes that implement ports with factory functions, replacing providers by Symbol,
  observable-effect assertions, determinism with fake timers and the 100%
  coverage target. Use when creating, modifying or reviewing *.spec.ts files.
---

# Automated testing best practices

> **Maintaining this skill**
>
> Update this document whenever **any rule described here** changes. The criterion is not
> *which* rule — it is the nature of the change: a testing guideline or convention changed →
> update; a technical refactor that preserves the described practice → leave it alone.

This guideline governs all of the application's automated tests, run via Vitest
and integrated with the NestJS testing module (`@nestjs/testing`).

## Stack and commands

- **Framework**: Vitest with `globals: true`.
- **Environment**: plain Node.js (`environment: 'node'`).
- **File location**: `*.spec.ts` placed **side by side** with the corresponding
  production file in `src/`.
- **E2E tests**: located in the `test/` directory and run with `vitest.config.e2e.ts`.
- **Commands**:
  - `yarn test`: Runs all unit tests once;
  - `yarn test:cov`: Runs the tests and generates a code coverage report;
  - `yarn test:e2e`: Runs the end-to-end tests.

## Golden rule: `vi.mock` only for external boundaries

**Internal project dependencies (any file located in `src/`) must never be
mocked using `vi.mock`.**

- **Allowed with `vi.mock`**:
  - Native Node platform modules: `node:fs`, `node:child_process`, `node:crypto`, etc.
  - Third-party SDKs and external network clients that perform real I/O (e.g. `@modelcontextprotocol/sdk`,
    the Discord.js client or external protocol libraries).
- **Forbidden with `vi.mock`**:
  - Any project port (`*.port.ts`), adapter (`*.adapter.ts`), use case (`*.use-case.ts`),
    service (`*.service.ts`) or controller/handler.

### Why stubs and fakes over `vi.mock`?

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
    connect: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue('default-session-id'),
    closeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

### Dependency injection in `Test.createTestingModule`

When using the NestJS testing utility, replace the concrete implementation by binding the
port's `Symbol` to the corresponding stub:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectAgentUseCase } from './connect-agent.use-case.ts';
import { IAgentClientPort } from '../ports/agent-client.port.ts';
import { StubAgentClientPort } from '../testing/agent-client.stub.ts';

describe('ConnectAgentUseCase', () => {
  let useCase: ConnectAgentUseCase;
  let stubAgentClient: StubAgentClientPort;

  beforeEach(async () => {
    stubAgentClient = new StubAgentClientPort();

    const module: TestingModule = await Test.createTestingModule({
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

Prefer explicit Vitest matchers to produce clear diagnostics on failure:

- `toHaveLength(n)` over `expect(array.length).toBe(n)`;
- `toBeNull()` and `toBeUndefined()` over `toBe(null)` / `toBe(undefined)`;
- `toContainEqual(...)` for collections of objects;
- `toThrowError(...)` or `rejects.toThrow(...)` for error validation.

## Determinism and time handling

Automated tests must be deterministic and independent of system clock latency:

- **No arbitrary `setTimeout`**: Never use fixed delays to wait for asynchronous executions.
  Use Vitest's `vi.waitFor(() => expect(...))` to wait for expected events or conditions.
- **Fake timers for time-based operations**: When testing timeouts, retries or debouncing,
  use Vitest's simulated timers (`vi.useFakeTimers()`) and advance time deliberately
  with `await vi.advanceTimersByTimeAsync(ms)`.

## Coverage targets

The operational target is **100% coverage of executable lines** of production code.

For each use case, adapter or service, ensure tests for:
1. The happy path;
2. Expected validations and rejections (specific exceptions thrown);
3. Edge cases (empty collections, boundary values, timeouts);
4. Every conditional branch (`if/else`, `??` and `||` operators).

## Style conventions

- Tests written in English (`describe('ClassName')`, `it('should ...', async () => ...)`).
- Clear Arrange-Act-Assert (AAA) structure in each test scenario.
- Prefix stubs with `Stub*` or `Fake*`.
- Isolate state: no test may depend on another's result; ensure data is reset
  in `beforeEach`.
- **No barrel exports**: Tests must import classes, interfaces, symbols and stubs directly from the source file where they are defined, without using `index.ts` files.

## Checklist

- [ ] No `vi.mock` pointing to files in `src/`.
- [ ] Stubs explicitly implement the port interfaces (`implements I...Port`).
- [ ] Replacement in the NestJS container done through the port's `Symbol`.
- [ ] Direct imports from source files, without barrel exports (`index.ts`).
- [ ] Assertions check state and observable effects before checking method calls.
- [ ] No real-time delays (`setTimeout`); exclusive use of `vi.waitFor` or fake timers.
- [ ] All branches and error handling covered by the spec.
- [ ] Mandatory validation run with `yarn lint` and `yarn test` (and `yarn test:e2e`).
