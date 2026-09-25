---
name: orchestrator
description: >
  Padrão de orquestração agnóstico a canais para controle de agentes de IA.
  Governa o ciclo de vida de turnos (ExecuteAgentTurnUseCase, CancelAgentTurnUseCase),
  o loop de delegação do CEO com marcadores [DELEGATE]/[DONE]/[AGENT_RESULT],
  sessões ACP isoladas por conversa via IAgentPortFactory, estruturas TurnRequest e
  TurnResult, armazenamento de contexto com ISessionStorePort, resolução de persona com
  IAgentRegistryPort e streaming reativo. Use ao implementar fluxos de turnos,
  delegação entre agentes, cancelamento, novas interfaces de canal ou persistência de sessões.
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
Ele recebe requisições padronizadas, mantém o estado conversacional, cria uma sessão
ACP própria para cada conversa, coordena a delegação do CEO para agentes especialistas
e repassa fluxos de atividade e texto sob demanda.

## Modelos Centrais

Os modelos residem em `src/modules/orchestrator/models/`:

### `SessionContext` (`session-context.model.ts`)

Representa o vínculo durável entre a origem conversacional e o ambiente de trabalho. Contém
apenas dados serializáveis; o estado de execução (agentes vivos, fila, turno ativo) pertence ao
`ConversationRuntimeService`:

- `sessionId`: identificador único da sessão (UUID v4 ou string estável);
- `channelId`: identificador do canal de origem (ex.: canal do Discord ou identificador de sala);
- `threadId`: identificador opcional da subtarefa ou thread aninhada;
- `userId`: identificador do usuário autor da sessão;
- `workspacePath`: caminho absoluto do diretório de trabalho do projeto;
- `agentRole`: papel raiz da conversa (ex.: `'CEO'`);
- `createdAt` e `updatedAt`: marcos temporais de ciclo de vida.

### `TurnRequest` (`turn-request.model.ts`)

Encapsula os parâmetros para execução de uma rodada de interação:

- `channelId`: canal solicitante;
- `threadId`: identificador opcional da thread;
- `userId`: autor do prompt;
- `prompt`: instrução enviada pelo usuário;
- `workspacePath`: diretório local de trabalho associado ao turno;
- `agentRole`: papel raiz que recebe o prompt (ex.: `'CEO'`);
- `onActivity`: callback opcional `(activity: AgentActivity) => void` para consumo reativo de pensamentos e ferramentas;
- `onTextChunk`: callback opcional `(chunk: string) => void` para streaming progressivo da resposta;
- `onQueued`: callback opcional `() => void` chamado quando o turno entra na fila atrás de outro turno da mesma conversa.

### `ActiveTurn` (`active-turn.model.ts`)

Representa o turno em execução de uma conversa:

- `activate(agentPort)`: registra o agente que está rodando (CEO ou delegado);
- `cancel()`: marca o turno como cancelado e chama `cancel()` no agente ativo;
- `throwIfCancelled()`: lança `PromptCancelledError` se o turno foi cancelado. O orquestrador o chama antes de `connect`, depois de `connect` e antes de cada `prompt`, para que um cancelamento pedido enquanto o agente ainda conecta interrompa o turno.

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

- `getSystemPrompt(agentRole: string): string`
- `getDefaultModel(agentRole: string): string | undefined`
- Symbol homônimo: `export const IAgentRegistryPort = Symbol('IAgentRegistryPort');`

A implementação é o `AgentRegistryService` do `AgentDefinitionsModule`, que resolve os
prompts completos de cada papel (`CEO`, `DEVELOPER`) e devolve um prompt genérico para
papéis desconhecidos.

### 3. `ConversationRuntimeService` (`services/conversation-runtime.service.ts`)

Mantém em memória o estado de execução de cada sessão (`sessionId`):

- **Agente da conversa**: um `IAgentPort` criado pela `IAgentPortFactory` na primeira execução e reutilizado nos turnos seguintes;
- **Fila de turnos**: `run(sessionId, work, onQueued)` executa os turnos de uma mesma sessão um de cada vez, na ordem de chegada. Um turno que chega com outro em andamento chama `onQueued`. Uma falha não interrompe a fila;
- **Turno ativo**: `cancel(sessionId)` cancela o `ActiveTurn` em execução e devolve `false` quando não há turno em andamento. Turnos na fila não são afetados;
- **Expiração por ociosidade**: sem turnos por `SESSION_IDLE_TIMEOUT_MS` (padrão 30 minutos), encerra o agente (`closeSession` + `disconnect`) e remove a sessão do `ISessionStorePort`. A mensagem seguinte da conversa inicia uma sessão nova;
- **Shutdown**: `onApplicationShutdown` desconecta todos os agentes. Requer `app.enableShutdownHooks()` no bootstrap.

### 4. `DelegationDetectorService` (`services/delegation-detector.service.ts`)

Interpreta o final da resposta do CEO e devolve uma `CeoDecision`:

- `{ kind: 'delegate', delegation: { delegateToRole, projectName, taskSpec } }` quando a resposta termina com `[DELEGATE:ROLE:project]` (o segmento `:project` é opcional). `taskSpec` é o texto anterior ao marcador;
- `{ kind: 'done', summary }` quando a resposta termina com `[DONE]`. `summary` é o texto anterior ao marcador;
- `{ kind: 'direct_response' }` quando não há marcador final.

Marcadores no meio do texto são ignorados: apenas o sufixo da resposta decide.

## Casos de Uso e Ciclo de Vida do Turno

### Hierarquia de Diretórios

O CEO opera na raiz de workspaces (`IWorkspacePort.getBaseDirectory()`, padrão
`./workspaces/` ou `WORKSPACE_DIR`), que o canal envia como `TurnRequest.workspacePath`.
Cada agente delegado opera em `IWorkspacePort.resolveRepositoryPath(project)`:

```text
./workspaces/                    ← cwd do CEO
├── workspace-manifest.json
├── my-backend/                  ← cwd do agente delegado com [DELEGATE:ROLE:my-backend]
└── my-frontend/
```

Antes de cada `createSession(cwd)`, o orquestrador chama `IWorkspacePort.ensureDirectory(cwd)`, pois o
`agy` falha ao iniciar em diretório inexistente. `resolveRepositoryPath` e `ensureDirectory` rejeitam
caminhos fora da raiz de workspaces, já que o nome do projeto vem da resposta do CEO. Clonar o
repositório dentro da pasta do projeto é responsabilidade do agente delegado.

### Protocolo de Marcadores

| Marcador no fim da resposta do CEO | Ação do orquestrador |
|---|---|
| `[DELEGATE:ROLE:project]` | Cria novo `IAgentPort` para `ROLE` com `cwd` no projeto e envia `systemPrompt(ROLE) + taskSpec` |
| `[DONE]` | Encerra o loop e devolve o texto anterior ao marcador |
| *(nenhum)* | Encerra o loop e devolve a resposta integral do CEO |

O resultado do agente delegado volta ao CEO como `[AGENT_RESULT:ROLE]\n<resposta>`.

### Execução de Turno (`ExecuteAgentTurnUseCase`)

Injeta `@Inject(IAgentPortFactory)`, `@Inject(ISessionStorePort)`, `@Inject(IAgentRegistryPort)`,
`@Inject(IWorkspacePort)`, `DelegationDetectorService` e `ConversationRuntimeService`.

A execução do método `execute(request: TurnRequest): Promise<TurnResult>` segue a sequência:

1. **Resolução de Sessão**: consulta `ISessionStorePort.findSession(channelId, threadId)`. Se inexistente, gera nova `SessionContext`; se existente, atualiza `updatedAt`. Salva no store.
2. **Enfileiramento**: executa o turno via `ConversationRuntimeService.run(sessionId, ...)`, que fornece o agente do CEO e o `ActiveTurn`.
3. **Loop de Delegação**: repete até `MAX_DELEGATION_ROUNDS` (10) rodadas:
   1. Executa o turno do CEO com `cwd = request.workspacePath`.
   2. Classifica a resposta com `DelegationDetectorService.detect()`. `direct_response` e `done` encerram com `status: 'completed'`.
   3. Em `delegate`, cria novo `IAgentPort` pela fábrica e executa o turno com `taskSpec` no diretório do projeto (ou em `request.workspacePath` sem projeto).
   4. No `finally`, executa `closeSession()` e `disconnect()` no agente delegado, ignorando falhas de encerramento.
   5. O próximo prompt do CEO passa a ser `[AGENT_RESULT:ROLE]\n<resposta do delegado>`.
4. **Limite de Rodadas**: esgotadas as rodadas, retorna `status: 'failed'` com `errorMessage: 'Max delegation rounds exceeded.'`.

Cada turno de agente (CEO ou delegado) executa internamente:

1. `turn.activate(agentPort)` e `turn.throwIfCancelled()`.
2. `connect()` seguido de `turn.throwIfCancelled()`.
3. Se `currentSessionId` não estiver definido: `ensureDirectory(cwd)`, `createSession(cwd)` e prefixo do prompt com `getSystemPrompt(role)`. O system prompt acompanha a criação da sessão ACP, e não a da `SessionContext`, para que uma sessão recriada após falha receba as instruções do papel.
4. `setConfig({ modelId })` quando `getDefaultModel(role)` retorna modelo.
5. Registro de `request.onActivity` via `onActivity(...)`, desfeito no `finally`. Atividades de todos os agentes fluem para o mesmo callback.
6. `turn.throwIfCancelled()` e drenagem de `prompt(text)`, despachando blocos `agent_message_chunk` para `request.onTextChunk`.
7. Resposta a partir de `lastAgentMessage` ou dos blocos acumulados.

**Tratamento de Cancelamento e Falhas**: `PromptCancelledError` (ou erro com nome
homônimo) lançado por qualquer agente ou pelo `ActiveTurn` retorna `status: 'cancelled'`. Demais
erros retornam `status: 'failed'` com `errorMessage`. Em ambos os casos, `response` recebe o
`lastAgentMessage` do CEO.

### Cancelamento de Turno (`CancelAgentTurnUseCase`)

Injeta `@Inject(ISessionStorePort)` e `ConversationRuntimeService`.

O método `execute(channelId: string, threadId?: string): Promise<boolean>`:

1. Localiza a sessão via `ISessionStorePort.findSession(channelId, threadId)`. Sem sessão, devolve `false`.
2. Aciona `ConversationRuntimeService.cancel(sessionId)` e devolve se havia turno em andamento. O `PromptCancelledError` resultante interrompe o loop de delegação.

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

  async cancelTurn(channelId: string, threadId?: string): Promise<boolean> {
    return this.cancelAgentTurnUseCase.execute(channelId, threadId);
  }
}
```

## Regras Prescritivas Mandatórias

- **Proibido acoplamento com Discord ou canais de rede**: o orquestrador manipula unicamente identificadores (`channelId`, `userId`, `threadId`), sem importar discord.js, HTTP frameworks ou drivers de terceiros.
- **Portas e Symbols**: toda dependência externa aos use cases deve utilizar injeção por Symbol (`@Inject(ISessionStorePort)`).
- **Sem barrel exports**: nunca crie `index.ts` em `models/`, `ports/`, `adapters/`, `services/` ou `use-cases/`.
- **Limpeza de recursos reativos**: todo callback registrado em `onActivity` deve ser desconectado em bloco `finally`.
- **Uma sessão ACP por conversa**: obtenha instâncias de `IAgentPort` exclusivamente pela `IAgentPortFactory`. O agente do CEO de cada conversa vive no `ConversationRuntimeService`, e cada delegação usa uma instância descartável.
- **Sessão só com dados**: `SessionContext` guarda apenas dados serializáveis. Agentes vivos, fila e turno ativo ficam no `ConversationRuntimeService`, para que o store possa ser substituído por uma persistência real.
- **Um turno por vez**: todo turno passa por `ConversationRuntimeService.run`. Chamar `prompt()` em paralelo no mesmo agente corrompe o estado de streaming do adapter.
- **Delegação cancelável**: todo agente em execução deve ser registrado com `turn.activate(agentPort)`, e `turn.throwIfCancelled()` deve preceder `connect` e `prompt`.
- **Limite de rodadas**: mantenha `MAX_DELEGATION_ROUNDS` para impedir loops infinitos entre CEO e agentes delegados.
- **Não vazar exceções em execute()**: `ExecuteAgentTurnUseCase.execute()` deve devolver `TurnResult` com `status: 'failed'` ou `status: 'cancelled'`, nunca lançar erros descontrolados para a camada de apresentação.
