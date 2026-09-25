---
name: clean-architecture-nestjs
description: >
  Padrão arquitetural Clean Architecture com Ports & Adapters em NestJS. Define a
  divisão em módulos verticais, portas tipadas com Symbol para injeção de dependência,
  adaptadores de infraestrutura, casos de uso orquestrando regras de negócio e
  adaptadores de entrada (Discord handlers, controllers). Use ao modelar, criar ou refatorar
  módulos, ports, adapters e use cases.
---

# Clean Architecture em NestJS (Ports & Adapters)

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar **qualquer regra descrita aqui**. O critério não
> é *qual* regra — é a natureza da mudança: uma diretriz de arquitetura, convenção de
> camadas ou regra de injeção mudou → atualize; refator técnico que preserva o padrão
> descrito → não toque.

Esta arquitetura rege a separação de responsabilidades em todo o código-fonte da aplicação.
O objetivo central é isolar as regras de negócio de detalhes técnicos e de bibliotecas externas
(Discord.js, SDK do ACP, sistema de arquivos ou rede), garantindo alta testabilidade, baixo
acoplamento e facilidade de evolução.

## Orquestração centralizada em Use Cases

A orquestração do comportamento e o fluxo de regras de negócio residem exclusivamente em **Casos de Uso (Use Cases)** independentes e coesos (`*.use-case.ts`). Não são utilizadas classes de workflows nem máquinas de estado acopladas.

## Divisão vertical em módulos NestJS

O código de negócio fica organizado em módulos verticais orientados a domínios dentro de
`src/modules/<nome>/`. Cada módulo encapsula suas portas, adaptadores, casos de uso e
handlers de entrada:

```text
src/modules/<nome>/
├── ports/              # Interfaces e Symbols das portas técnicas (*.port.ts)
├── adapters/           # Implementações concretas de tecnologia (*.adapter.ts)
├── use-cases/          # Regras de negócio e orquestração (*.use-case.ts)
├── services/           # Serviços utilitários concretos sem variação (*.service.ts)
├── handlers/           # Adaptadores primários (ex.: Discord handlers, controllers)
└── <nome>.module.ts    # Configuração e amarração de injeção de dependência NestJS
```

## Camadas e convenções

### 1. Ports (`*.port.ts`)

Uma porta define um contrato de fronteira exigido pelas regras de negócio. Como interfaces em
TypeScript são apagadas em tempo de compilação, **toda porta exporta tanto a `interface` quanto
um `Symbol` homônimo com o mesmo nome**:

```typescript
export interface IAgentClientPort {
  connect(targetUri: string): Promise<void>;
  disconnect(): Promise<void>;
  sendPrompt(prompt: string): Promise<string>;
}

export const IAgentClientPort = Symbol('IAgentClientPort');
```

- Localize em `src/modules/<nome>/ports/<nome-da-porta>.port.ts`;
- O nome da interface inicia com `I` maiúsculo e termina com `Port`;
- O `Symbol` possui o mesmo identificador da interface;
- Métodos de porta utilizam tipos puros de domínio ou DTOs primitivos, nunca tipos de bibliotecas
  externas.

### 2. Adapters (`*.adapter.ts`)

Um adaptador é a implementação concreta de uma porta tecnológica (Driven / Secondary Adapter).
Consome SDKs externos, drivers de I/O ou a API do sistema operacional:

```typescript
import { Injectable } from '@nestjs/common';
import { IAgentClientPort } from '../ports/agent-client.port.ts';

@Injectable()
export class AcpAgentClientAdapter implements IAgentClientPort {
  async connect(targetUri: string): Promise<void> {
    // implementação concreta consumindo o SDK do ACP
  }

  async disconnect(): Promise<void> {
    // encerramento de conexão
  }

  async sendPrompt(prompt: string): Promise<string> {
    // envio do prompt via protocolo
    return 'response';
  }
}
```

- Localize em `src/modules/<nome>/adapters/<nome-do-adapter>.adapter.ts`;
- Decorado obrigatoriamente com `@Injectable()`;
- Declara explicitamente `implements I<Nome>Port`.

### 3. Use Cases (`*.use-case.ts`)

Um caso de uso orquestra uma ação ou regra de negócio específica do sistema. Possui
responsabilidade única (*Single Responsibility Principle*):

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

- Localize em `src/modules/<nome>/use-cases/<nome-da-acao>.use-case.ts`;
- Decorado obrigatoriamente com `@Injectable()`;
- Injeta portas utilizando `@Inject(IMyPort)` associado ao `Symbol` da porta;
- Expõe método público primário `execute(input)`;
- **Nunca importa diretamente classes de adaptadores concretos**: depende exclusivamente dos ports.

### 4. Services Concretos (`*.service.ts`)

Utilizados para lógica utilitária, cálculos internos ou agregação técnica auxiliar quando
**não há previsão de variação ou troca tecnológica**:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class MessageFormatterService {
  formatDiscordOutput(content: string): string {
    return `\`\`\`${content}\`\`\``;
  }
}
```

- Localize em `src/modules/<nome>/services/<nome>.service.ts`;
- Decorado com `@Injectable()`.

### 5. Controllers e Handlers (`*.controller.ts`, `*.handler.ts`)

Adaptadores primários de entrada (Driving / Primary Adapters). Recebem eventos externos
(interações do Discord, comandos barra, webhooks ou rotas HTTP):

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

- Localize em `src/modules/<nome>/handlers/` ou `src/modules/<nome>/controllers/`;
- Recebem e validam a entrada superficial do usuário ou protocolo externo;
- Delegam a execução imediatamente para um ou mais Casos de Uso;
- Formatam a resposta de retorno de volta para o cliente.

## Registro e Injeção de Dependências no Módulo NestJS

A vinculação entre a porta abstrata e sua implementação concreta é configurada no arquivo
`<nome>.module.ts` através do `provide` com o `Symbol` da porta:

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

## Regras de Dependência e Fronteiras

1. **Sentido das dependências**: Handlers/Controllers → Use Cases → Ports ← Adapters.
2. **Casos de uso não conhecem tecnologia**: Use Cases nunca importam nada de `adapters/`,
   `discord.js`, SDKs proprietários ou drivers de infraestrutura.
3. **Proibição de barrel exports**: Não crie arquivos `index.ts`. Importe sempre a partir do
   arquivo original.
4. **Um use case por arquivo**: Cada classe de Caso de Uso mora em seu próprio arquivo `*.use-case.ts`,
   com seu teste correspondente `*.use-case.spec.ts`.

## Checklist

- [ ] Porta criada com `interface` e `Symbol` com o mesmo nome (`export const IPort = Symbol('IPort')`).
- [ ] Adaptador implementa a porta (`implements IPort`) e utiliza o decorator `@Injectable()`.
- [ ] Caso de uso injeta a porta via `@Inject(IPort)` e contém método `execute()`.
- [ ] Caso de uso livre de imports de tecnologias concretas ou SDKs de terceiros.
- [ ] Amarração realizada no módulo NestJS com `{ provide: IPort, useClass: MyAdapter }`.
- [ ] Nenhum conceito de workflow introduzido no módulo.
