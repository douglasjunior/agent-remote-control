---
name: orchestrator
description: >
  Padrão de orquestração agnóstico a canais para controle de agentes de IA.
  Governa o ciclo de vida de turnos (ExecuteAgentTurnUseCase, CancelAgentTurnUseCase),
  estruturas TurnRequest e TurnResult, armazenamento de contexto de sessão com
  ISessionStorePort, resolução de persona com IAgentRegistryPort e streaming reativo.
  Use ao implementar fluxos de turnos, cancelamento, novas interfaces de canal ou
  persistência de sessões.
---

# Orquestrador de Agentes Agnóstico a Canais

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é qual regra — é a natureza da mudança: uma diretriz ou convenção do orquestrador
> mudou → atualize; refator técnico que preserva o padrão descrito → não toque.

O módulo `OrchestratorModule` reside em `src/modules/orchestrator/` e centraliza
toda a coordenação de turnos entre clientes de entrada (canais de chat como Discord,
APIs HTTP ou tarefas agendadas) e os adaptadores de agentes de desenvolvimento.

O orquestrador é completamente desacoplado da tecnologia de apresentação dos canais.
Ele recebe requisições padronizadas, mantém o estado conversacional, conecta-se
à porta do agente e repassa fluxos de atividade e texto sob demanda.

## Modelos Centrais

Os modelos residem em `src/modules/orchestrator/models/`:

### `SessionContext` (`session-context.model.ts`)

Representa o vínculo durável entre a origem conversacional e o ambiente de trabalho:

- `sessionId`: identificador único da sessão (UUID v4 ou string estável);
- `channelId`: identificador do canal de origem (ex.: canal do Discord ou identificador de sala);
- `threadId`: identificador opcional da subtarefa ou thread aninhada;
- `userId`: identificador do usuário autor da sessão;
- `workspacePath`: caminho absoluto do diretório de trabalho do projeto;
- `agentId`: papel ou persona atribuído à sessão (ex.: `'DEVELOPER'`, `'CEO'`);
- `createdAt` e `updatedAt`: marcos temporais de ciclo de vida.

### `TurnRequest` (`turn-request.model.ts`)

Encapsula os parâmetros para execução de uma rodada de interação:

- `channelId`: canal solicitante;
- `threadId`: identificador opcional da thread;
- `userId`: autor do prompt;
- `prompt`: instrução enviada pelo usuário;
- `workspacePath`: diretório local de trabalho associado ao turno;
- `agentRole`: papel funcional opcional solicitado para o turno;
- `onActivity`: callback opcional `(activity: AgentActivity) => void` para consumo reativo de pensamentos e ferramentas;
- `onTextChunk`: callback opcional `(chunk: string) => void` para streaming progressivo da resposta.

### `TurnResult` (`turn-result.model.ts`)

Estrutura imutável com o desfecho do turno:

- `sessionId`: identificador da sessão processada;
- `response`: resposta textual final consolidada;
- `status`: `'completed'` em caso de sucesso, `'cancelled'` se interrompido, ou `'failed'` se abortado por erro;
- `usage`: dados opcionais de consumo de tokens (`AgentUsage`);
- `errorMessage`: mensagem de erro presente exclusivamente em desfechos com falha.

## Portas do Orquestrador

As portas do orquestrador residem em `src/modules/orchestrator/ports/`:

### 1. `ISessionStorePort` (`session-store.port.ts`)

Responsável pela persistência e consulta do estado das sessões:

- `findSession(channelId: string, threadId?: string): Promise<SessionContext | null>`
- `saveSession(session: SessionContext): Promise<void>`
- `removeSession(sessionId: string): Promise<void>`
- Symbol homônimo: `export const ISessionStorePort = Symbol('ISessionStorePort');`

A implementação em memória padrão é fornecida por `InMemorySessionStoreAdapter`.

### 2. `IAgentRegistryPort` (`agent-registry.port.ts`)

Contrato para resolução de instruções comportamentais e especificações de modelo:

- `getSystemPrompt(agentRoleOrId?: string): string | undefined`
- `getDefaultModel(agentRoleOrId?: string): string | undefined`
- Symbol homônimo: `export const IAgentRegistryPort = Symbol('IAgentRegistryPort');`

A implementação padrão de fallback é fornecida por `DefaultAgentRegistryAdapter`.

## Casos de Uso e Ciclo de Vida do Turno

### Execução de Turno (`ExecuteAgentTurnUseCase`)

Injeta `@Inject(IAgentPort)`, `@Inject(ISessionStorePort)` e `@Inject(IAgentRegistryPort)`.

A execução do método `execute(request: TurnRequest): Promise<TurnResult>` segue a sequência estrita:

1. **Resolução de Sessão**: consulta `ISessionStorePort.findSession(channelId, threadId)`. Se inexistente, gera nova `SessionContext` e salva no store. Se existente, atualiza `updatedAt` e salva.
2. **Conexão**: assegura transporte ativo via `IAgentPort.connect()`.
3. **Criação de Sessão**: verifica se `IAgentPort.currentSessionId` está definido. Caso negativo, inicializa a sessão via `IAgentPort.createSession(workspacePath)`.
4. **Configuração de Modelo**: consulta `IAgentRegistryPort.getDefaultModel(agentRole)`. Havendo modelo especificado, despacha `IAgentPort.setConfig({ modelId })`.
5. **Registro de Atividades**: se `request.onActivity` for fornecido, vincula listener através de `IAgentPort.onActivity(...)` e assegura o cancelamento do registro no bloco `finally`.
6. **Construção do Prompt**: se for o primeiro turno da sessão (`isFirstTurn`) e houver `systemPrompt` não vazio retornado por `IAgentRegistryPort.getSystemPrompt(agentRole)`, prefixa o prompt com `${systemPrompt}\n\n${prompt}`. Nos turnos subsequentes, despacha o prompt puro.
7. **Drenagem do Gerador**: itera sobre o gerador assíncrono `IAgentPort.prompt(fullPrompt)`. Extrai blocos de texto do tipo `agent_message_chunk` e despacha para `request.onTextChunk`.
8. **Consolidação**: coleta métricas em `IAgentPort.getLastRoundUsage()` e define a resposta a partir de `IAgentPort.lastAgentMessage` ou dos blocos acumulados.
9. **Tratamento de Cancelamento**: intercepta `PromptCancelledError` (ou erro com nome homônimo), retornando `status: 'cancelled'`, uso consolidado e resposta parcial.
10. **Tratamento de Falhas**: captura erros gerais sem propagar exceção não tratada, retornando `status: 'failed'` e preenchendo `errorMessage`.

### Cancelamento de Turno (`CancelAgentTurnUseCase`)

Injeta `@Inject(IAgentPort)` e `@Inject(ISessionStorePort)`.

O método `execute(channelId: string, threadId?: string): Promise<void>`:

1. Localiza a sessão ativa via `ISessionStorePort.findSession(channelId, threadId)`.
2. Se nenhuma sessão for encontrada, encerra imediatamente sem ação.
3. Se a sessão existir, aciona a rotina de cancelamento escalonado via `IAgentPort.cancel()`.

## Fachada de Serviço (`OrchestratorService`)

Encapsula os casos de uso de execução e cancelamento em uma interface simplificada:

```typescript
@Injectable()
export class OrchestratorService {
  constructor(
    private readonly executeAgentTurnUseCase: ExecuteAgentTurnUseCase,
    private readonly cancelAgentTurnUseCase: CancelAgentTurnUseCase,
  ) {}

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    return this.executeAgentTurnUseCase.execute(request);
  }

  async cancelTurn(channelId: string, threadId?: string): Promise<void> {
    return this.cancelAgentTurnUseCase.execute(channelId, threadId);
  }
}
```

## Regras Prescritivas Mandatórias

- **Proibido acoplamento com Discord ou canais de rede**: o orquestrador manipula unicamente identificadores (`channelId`, `userId`, `threadId`), sem importar discord.js, HTTP frameworks ou drivers de terceiros.
- **Portas e Symbols**: toda dependência externa aos use cases deve utilizar injeção por Symbol (`@Inject(ISessionStorePort)`).
- **Sem barrel exports**: nunca crie `index.ts` em `models/`, `ports/`, `adapters/`, `services/` ou `use-cases/`.
- **Limpeza de recursos reativos**: todo callback registrado em `onActivity` deve ser desconectado em bloco `finally`.
- **Não vazar exceções em execute()**: `ExecuteAgentTurnUseCase.execute()` deve devolver `TurnResult` com `status: 'failed'` ou `status: 'cancelled'`, nunca lançar erros descontrolados para a camada de apresentação.
