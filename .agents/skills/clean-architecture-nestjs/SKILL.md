---
name: clean-architecture-nestjs
description: >
  Clean Architecture with Ports & Adapters architectural pattern in NestJS. Defines the
  split into vertical modules, ports typed with Symbol for dependency injection,
  infrastructure adapters, use cases orchestrating business rules and
  inbound adapters (Discord handlers, controllers). Use when modeling, creating or refactoring
  modules, ports, adapters and use cases.
---

# Clean Architecture in NestJS (Ports & Adapters)

> **Maintaining this skill**
>
> Update this document whenever **any rule described here** changes. The criterion is not
> *which* rule — it is the nature of the change: an architecture guideline, layering
> convention or injection rule changed → update; a technical refactor that preserves the
> described pattern → leave it alone.

This architecture governs the separation of responsibilities across the application's entire source code.
The central goal is to isolate business rules from technical details and external libraries
(Discord.js, the ACP SDK, the file system or the network), ensuring high testability, low
coupling and ease of evolution.

## Orchestration centralized in Use Cases

Behavior orchestration and business rule flow reside exclusively in independent, cohesive **Use Cases** (`*.use-case.ts`). Workflow classes and coupled state machines are not used.

## Vertical split into NestJS modules

Business code is organized into domain-oriented vertical modules under
`src/modules/<name>/`. Each module encapsulates its ports, adapters, use cases and
inbound handlers:

```text
src/modules/<name>/
├── ports/              # Interfaces and Symbols of the technical ports (*.port.ts)
├── adapters/           # Concrete technology implementations (*.adapter.ts)
├── use-cases/          # Business rules and orchestration (*.use-case.ts)
├── services/           # Concrete utility services with no variation (*.service.ts)
├── handlers/           # Primary adapters (e.g. Discord handlers, controllers)
└── <name>.module.ts    # NestJS dependency injection configuration and wiring
```

## Layers and conventions

### 1. Ports (`*.port.ts`)

A port defines a boundary contract required by the business rules. Since TypeScript
interfaces are erased at compile time, **every port exports both the `interface` and
a `Symbol` with the same name**:

```typescript
export interface IAgentClientPort {
  connect(targetUri: string): Promise<void>;
  disconnect(): Promise<void>;
  sendPrompt(prompt: string): Promise<string>;
}

export const IAgentClientPort = Symbol('IAgentClientPort');
```

- Place in `src/modules/<name>/ports/<port-name>.port.ts`;
- The interface name starts with a capital `I` and ends with `Port`;
- The `Symbol` has the same identifier as the interface;
- Port methods use pure domain types or primitive DTOs, never types from external
  libraries.

### 2. Adapters (`*.adapter.ts`)

An adapter is the concrete implementation of a technology port (Driven / Secondary Adapter).
It consumes external SDKs, I/O drivers or the operating system API:

```typescript
import { Injectable } from '@nestjs/common';
import { IAgentClientPort } from '../ports/agent-client.port.ts';

@Injectable()
export class AcpAgentClientAdapter implements IAgentClientPort {
  async connect(targetUri: string): Promise<void> {
    // concrete implementation consuming the ACP SDK
  }

  async disconnect(): Promise<void> {
    // connection shutdown
  }

  async sendPrompt(prompt: string): Promise<string> {
    // sends the prompt via the protocol
    return 'response';
  }
}
```

- Place in `src/modules/<name>/adapters/<adapter-name>.adapter.ts`;
- Must be decorated with `@Injectable()`;
- Explicitly declares `implements I<Name>Port`.

### 3. Use Cases (`*.use-case.ts`)

A use case orchestrates a specific system action or business rule. It has a
single responsibility (*Single Responsibility Principle*):

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { IAgentClientPort } from '../ports/agent-client.port.ts';

export type SendAgentPromptInput = {
  prompt: string;
};

export type SendAgentPromptOutput = {
  response: string;
};

@Injectable()
export class SendAgentPromptUseCase {
  constructor(
    @Inject(IAgentClientPort)
    private readonly agentClientPort: IAgentClientPort,
  ) {}

  async execute(input: SendAgentPromptInput): Promise<SendAgentPromptOutput> {
    if (!input.prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }

    const response = await this.agentClientPort.sendPrompt(input.prompt);
    return { response };
  }
}
```

- Place in `src/modules/<name>/use-cases/<action-name>.use-case.ts`;
- Must be decorated with `@Injectable()`;
- Injects ports using `@Inject(IMyPort)` bound to the port's `Symbol`;
- Exposes a primary public method `execute(input)`;
- **Never imports concrete adapter classes directly**: depends exclusively on ports.

### 4. Concrete Services (`*.service.ts`)

Used for utility logic, internal calculations or auxiliary technical aggregation when
**no variation or technology swap is expected**:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class MessageFormatterService {
  formatDiscordOutput(content: string): string {
    return `\`\`\`${content}\`\`\``;
  }
}
```

- Place in `src/modules/<name>/services/<name>.service.ts`;
- Decorated with `@Injectable()`.

### 5. Controllers and Handlers (`*.controller.ts`, `*.handler.ts`)

Primary inbound adapters (Driving / Primary Adapters). They receive external events
(Discord interactions, slash commands, webhooks or HTTP routes):

```typescript
import { Injectable } from '@nestjs/common';
import { SendAgentPromptUseCase } from '../use-cases/send-agent-prompt.use-case.ts';

@Injectable()
export class DiscordCommandHandler {
  constructor(
    private readonly sendAgentPromptUseCase: SendAgentPromptUseCase,
  ) {}

  async handlePromptCommand(interaction: DiscordCommandInteraction): Promise<void> {
    const prompt = interaction.options.getString('prompt', true);
    await interaction.deferReply();

    const output = await this.sendAgentPromptUseCase.execute({ prompt });
    await interaction.editReply(output.response);
  }
}
```

- Place in `src/modules/<name>/handlers/` or `src/modules/<name>/controllers/`;
- Receive and validate the surface input from the user or external protocol;
- Delegate execution immediately to one or more Use Cases;
- Format the response back to the client.

## Dependency Registration and Injection in the NestJS Module

The binding between the abstract port and its concrete implementation is configured in the
`<name>.module.ts` file through `provide` with the port's `Symbol`:

```typescript
import { Module } from '@nestjs/common';
import { IAgentClientPort } from './ports/agent-client.port.ts';
import { AcpAgentClientAdapter } from './adapters/acp-agent-client.adapter.ts';
import { SendAgentPromptUseCase } from './use-cases/send-agent-prompt.use-case.ts';
import { DiscordCommandHandler } from './handlers/discord-command.handler.ts';

@Module({
  providers: [
    SendAgentPromptUseCase,
    DiscordCommandHandler,
    {
      provide: IAgentClientPort,
      useClass: AcpAgentClientAdapter,
    },
  ],
  exports: [SendAgentPromptUseCase],
})
export class AgentModule {}
```

## Dependency Rules and Boundaries

1. **Dependency direction**: Handlers/Controllers → Use Cases → Ports ← Adapters.
2. **Use cases know no technology**: Use Cases never import anything from `adapters/`,
   `discord.js`, proprietary SDKs or infrastructure drivers.
3. **No barrel exports**: Do not create `index.ts` files. Always import from the
   original file.
4. **One use case per file**: Each Use Case class lives in its own `*.use-case.ts` file,
   with its corresponding test `*.use-case.spec.ts`.
5. **Mandatory lint and test validation**: Every code change requires running
   `yarn lint` and `yarn test` (and `yarn test:e2e` when it affects entry points). Code
   formatting is done exclusively via ESLint (`yarn format`).

## Checklist

- [ ] Port created with an `interface` and a `Symbol` with the same name (`export const IPort = Symbol('IPort')`).
- [ ] Adapter implements the port (`implements IPort`) and uses the `@Injectable()` decorator.
- [ ] Use case injects the port via `@Inject(IPort)` and contains an `execute()` method.
- [ ] Use case free of imports of concrete technologies or third-party SDKs.
- [ ] Wiring done in the NestJS module with `{ provide: IPort, useClass: MyAdapter }`.
- [ ] No workflow concept introduced in the module.
- [ ] Validation run with `yarn lint` and `yarn test` passing 100%.
