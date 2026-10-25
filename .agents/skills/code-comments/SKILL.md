---
name: code-comments
description: >
  Defines when a comment is allowed and when it is noise in TypeScript and NestJS
  code. Eliminates obvious comments that repeat the code, section headers, explained
  imports and narration of past edits. Establishes the three-question test and the
  mandatory pruning pass before closing the task. Use when creating, editing or
  reviewing .ts, .json or YAML files.
---

# Source code comments

> **Maintaining this skill**
>
> Update this document whenever **any rule described here** changes. The criterion is not
> *which* rule — it is the nature of the change: the project's comment policy changed →
> update; a technical refactor that preserves the described policy → leave it alone.

This rule applies to the whole repository, in every TypeScript source file (`*.ts`),
configuration file (`*.json`, `*.yaml`) and script.

## A comment is the exception, not a habit

Avoid comments unless they are strictly necessary to explain a non-intuitive decision, an
external technical constraint, a tradeoff or context that cannot be reached by reading the
code alone. The code must be self-explanatory through expressive names, strict types and
cohesive abstractions.

Correct — explains external context and a constraint the code does not express on its own:

```typescript
/*
 * The ACP SDK requires the cwd to be sent normalized in POSIX format to avoid
 * path resolution failures on Windows platforms and containerized environments.
 */
const normalizedCwd = cwd.replace(/\\/g, '/');
```

Avoid — merely repeats the visible mechanics of the code:

```typescript
// replaces backslashes with forward slashes
const normalizedCwd = cwd.replace(/\\/g, '/');
```

The symbol name, the method signature and the TypeScript types are the primary channel of
explanation. Before resorting to a comment, remove the ambiguity: rename the variable,
extract constants for magic numbers or strings, strengthen the types or extract private
methods in the class.

## Three-question test

Submit every intended comment to the three questions below before writing it. If the answer
to any of them is "no", **the comment does not go in**:

1. **Does it say something the code does not?** If the information can be inferred by reading
   the types, the method name or the following statements, it is noise.
2. **Would a competent reader try the alternative it rules out?** Comments explaining "why we
   did not do X" only make sense if X is an attractive, common approach that fails for a
   non-obvious reason.
3. **Will it still be true after the next refactor?** Comments describing the order of steps,
   variable names or internal flows become lies as soon as the code is refactored. Only
   durable decisions survive.

## Catalog of forbidden comments

The following cases illustrate violations that must be actively eliminated:

**Repeating the signature, class or method name:**

```typescript
// finds the agent by id
async findAgentById(id: string): Promise<AgentEntity> {
```

**Commenting imports or dependency injections in NestJS:**

```typescript
// imports the connection use case
import { ConnectAgentUseCase } from './connect-agent.use-case.ts';

// injects the Discord port
@Inject(IDiscordPort)
private readonly discordPort: IDiscordPort,
```

**Section headers, dividers or visual separators:**

```typescript
// ==========================================
// Event Handlers
// ==========================================
// Private Methods
```

**Naming a trivial step inside a method:**

```typescript
// checks whether the payload exists
if (!payload) throw new BadRequestException();

// calls the use case
await this.useCase.execute(payload);
```

**JSDoc that merely duplicates TypeScript type information:**

```typescript
/**
 * @param sessionId - The session ID
 * @returns Returns the found session
 */
```

**Vague TODO or FIXME comments without context:**
Markers such as `// TODO: fix later` or `// FIXME: error here` without a description of the
completion criterion or a link to an issue are forbidden. Debts and pending work belong to the
backlog or the task description, not to the source code.

## The comment describes today's code

The reader looks at the file in the present, with no interest in the revision history that
produced that line.

- **Do not comment the edit**: Explanations about discarded previous approaches, old fixed bugs
  or migration rationale belong to the commit message and the Pull Request.
- **Write from the final result**: Describe the constraint as a characteristic of the current
  code, never as a transition ("became", "stopped using").

## Pruning pass before closing the task

Before finishing any task that adds or changes code:

1. Inspect every added comment line in the diff (`git diff`).
2. Apply the three-question test to each one.
3. Delete without hesitation any redundant comment, syntax explanation or narration of a
   recent edit.
