---
name: code-organization
description: >
  Defines the internal organization of files and modules in TypeScript and NestJS:
  minimal public surface, a total ban on barrel exports (index.ts), export restricted
  to real external consumption and placement of helpers as private methods in Use
  Case, Adapter and Service classes. Establishes readability and immutability
  conventions with const. Use when creating, editing or refactoring classes, methods
  and functions.
---

# Internal organization of modules and code

> **Maintaining this skill**
>
> Update this document whenever **any rule described here** changes. The criterion is not
> *which* rule — it is the nature of the change: a project rule on public surface, helper
> placement or readability changed → update; a technical refactor that preserves the
> described pattern → leave it alone.

This guideline applies to the repository's TypeScript code and NestJS modules. It governs
the internal content of files, what is exposed and how classes and functions are organized.

## Minimal public surface

### Ban on barrel exports (`index.ts`)

Using `index.ts` files to re-export multiple symbols from a folder or module is
**forbidden across the whole repository**.

In the NestJS ecosystem, with dependency injection and metadata decorators, barrel files
introduce hidden circular dependencies, hinder tree-shaking and improperly couple consumers
to internal details.

Correct — direct, targeted import from the source file:

```typescript
import { ConnectAgentUseCase } from './use-cases/connect-agent.use-case.ts';
import { IAgentClientPort } from './ports/agent-client.port.ts';
```

Avoid — barrel re-export:

```typescript
// index.ts inside use-cases/ or modules/agent/
export * from './connect-agent.use-case.ts';
export * from './disconnect-agent.use-case.ts';
```

### `export` only under real external consumption

Do not add `export` for convenience or in anticipation. Export only what is consumed outside
the file:

1. Keep types, internal interfaces, constants and helper functions local, without `export`, if
   only the file itself uses them.
2. If, after a refactor, a symbol is not imported by any other file, remove the `export`
   keyword.
3. Do not export internal constants or configuration keys if they belong strictly to the
   class implementation.

Correct:

```typescript
const DEFAULT_TIMEOUT_MS = 5000;

export class AgentTimeoutException extends Error {
  constructor(message = `Operation timed out after ${DEFAULT_TIMEOUT_MS}ms`) {
    super(message);
  }
}
```

Avoid:

```typescript
export const DEFAULT_TIMEOUT_MS = 5000; // export without an external consumer

export class AgentTimeoutException extends Error { ... }
```

## Where the helper lives

### A single-consumer helper does not become a separate file

A helper function used exclusively by a single class or component must not be extracted to a
separate file with its own test suite. Keep it in the same file as its consumer.

Extract it to its own file only when:

1. There are **multiple real consumers** in different places; or
2. Its algorithmic complexity is significant enough to justify a unit test suite isolated
   from the consumer.

### In classes, the helper is a private method

When the file contains a class that owns the behavior (a Use Case, Adapter, Service or
Handler), any supporting helper function is declared as a **`private` method of the class**,
not as a free function loose in the file body:

Correct — responsibility contained in the class:

```typescript
@Injectable()
export class AcpAgentAdapter implements IAgentClientPort {
  async connect(targetUri: string): Promise<void> {
    const sanitizedUri = this.sanitizeUri(targetUri);
    // ...
  }

  private sanitizeUri(uri: string): string {
    return uri.trim().replace(/\/+$/, '');
  }
}
```

Avoid — loose function in the class file:

```typescript
function sanitizeUri(uri: string): string {
  return uri.trim().replace(/\/+$/, '');
}

@Injectable()
export class AcpAgentAdapter implements IAgentClientPort {
  async connect(targetUri: string): Promise<void> {
    const sanitizedUri = sanitizeUri(targetUri);
    // ...
  }
}
```

Even if the function is pure, encapsulating it as a private method answers objectively who
owns it, prevents other developers from importing it inadvertently and keeps the class
focused. The class's unit test exercises the helper through its public API.

Only `type` and `interface` definitions, local enums and immutable configuration constants
stay at the file's top level.

## Readability and flow clarity

### `const` by default

Use `const` for every variable declaration. Use `let` only in the rare cases where
reassigning the value is strictly necessary.

### Early return and guard clauses

Avoid deeply nested `if/else` blocks. Use guard clauses with an early return or exception
right at the start of methods:

Correct:

```typescript
async execute(input: ConnectAgentInput): Promise<ConnectAgentOutput> {
  if (!input.agentId) {
    throw new InvalidAgentIdException('Agent ID is required');
  }

  if (this.sessionManager.isActive(input.agentId)) {
    return this.sessionManager.get(input.agentId);
  }

  return this.createNewSession(input);
}
```

Avoid:

```typescript
async execute(input: ConnectAgentInput): Promise<ConnectAgentOutput> {
  if (input.agentId) {
    if (!this.sessionManager.isActive(input.agentId)) {
      return this.createNewSession(input);
    } else {
      return this.sessionManager.get(input.agentId);
    }
  } else {
    throw new InvalidAgentIdException('Agent ID is required');
  }
}
```

## Checklist

- [ ] No `index.ts` file created or used for bulk re-exports.
- [ ] Every `import` points directly to the file that declares the symbol.
- [ ] Only externally consumed classes, interfaces and functions have `export`.
- [ ] Helper functions supporting classes are declared as `private` methods.
- [ ] Variables declared exclusively with `const`, except for deliberate reassignment.
- [ ] Methods structured with guard clauses and early returns, without nested `if/else`.
