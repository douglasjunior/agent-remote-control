---
name: orchestrator
description: >
  Orquestração agnóstica a canais para agentes de IA: turnos, delegação do CEO com
  [DELEGATE]/[DONE]/[AGENT_RESULT], retomada de sessão ACP persistida por papel (agentSessions,
  DATA_DIR), seleção global de modelo/effort, rodapé com TurnResult.agentInfo,
  cancelamento, fila por conversa e ISessionStorePort. Use ao implementar turnos,
  delegação, cancelamento, persistência de sessões e configurações, seleção de modelo
  ou novas interfaces de canal.
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
- `agentSessions`: lista de `AgentSession` (`agent-session.model.ts`: `role`, `sessionId`) com a sessão ACP de cada papel (CEO e delegados), no máximo uma por papel, usada para retomá-las com `loadSession`. Uma sessão nova começa com a lista vazia;
- `createdAt` e `updatedAt`: marcos temporais de ciclo de vida.

### `TurnRequest` (`turn-request.model.ts`)

Encapsula os parâmetros para execução de uma rodada de interação:

- `channelId`: canal solicitante;
- `threadId`: identificador opcional da thread;
- `userId`: autor do prompt;
- `prompt`: instrução enviada pelo usuário;
- `workspacePath`: diretório local de trabalho associado ao turno;
- `agentRole`: papel raiz que recebe o prompt (ex.: `'CEO'`);
- `attachments`: lista opcional de `TurnAttachment` (`turn-attachment.model.ts`: `name`, `path`, `contentType`, `size`, `url?`) com arquivos recebidos e baixados localmente;
- `onActivity`: callback opcional `(activity: AgentActivity) => void` para consumo reativo de pensamentos e ferramentas;
- `onTextChunk`: callback opcional `(chunk: string) => void` para streaming progressivo da resposta;
- `onQueued`: callback opcional `() => void` chamado quando o turno entra na fila atrás de outro turno da mesma conversa.
- `onDelegation`: callback opcional `(event: DelegationEvent) => void` (`delegation-event.model.ts`), chamado com `phase: 'started'` antes de o delegado trabalhar e `phase: 'finished'` quando ele conclui com sucesso; carrega `round`, `role`, `roleName` e `projectName?`. O `finished` traz também `response`, `agentInfo` e `usage` do delegado e `durationMs`.

### `ActiveTurn` (`active-turn.model.ts`)

Representa o turno em execução de uma conversa:

- `activate(agentPort)`: registra o agente que está rodando (CEO ou delegado);
- `cancel()`: marca o turno como cancelado e chama `cancel()` no agente ativo;
- `reset()`: redefine o estado de cancelamento para falso;
- `throwIfCancelled()`: lança `PromptCancelledError` se o turno foi cancelado. O orquestrador o chama antes de `connect`, depois de `connect` e antes de cada `prompt`, para que um cancelamento pedido enquanto o agente ainda conecta interrompa o turno.

### `ActiveDelegation` (`active-delegation.model.ts`)

Representa uma delegação técnica atualmente em andamento em segundo plano:

- `role`: papel do agente delegado;
- `roleName`: nome legível do papel;
- `projectName`: projeto/diretório alvo da tarefa ou `null`;
- `taskSpec`: especificação corrente da tarefa delegada;
- `cwd`: diretório de trabalho do delegado;
- `startedAt`: timestamp de início;
- `agentPort`: instância `IAgentPort` do agente delegado;
- `turn`: instância `ActiveTurn` associada à execução do delegado;
- `steer(newSpec)`: redireciona a execução da tarefa via steering nativo ACP.

### `TurnResult` (`turn-result.model.ts`)

Estrutura imutável com o desfecho do turno:

- `sessionId`: identificador da sessão processada; ausente quando o turno falha antes de abrir a sessão;
- `response`: resposta textual final consolidada;
- `status`: `'completed'` em caso de sucesso, `'cancelled'` se interrompido, ou `'failed'` se abortado por erro;
- `usage`: consumo de tokens da última rodada do CEO (`getLastRoundUsage()`); ausente quando o agente não informa ou a coleta falha;
- `errorMessage`: mensagem de erro presente exclusivamente em desfechos com falha;
- `agentInfo`: `TurnAgentInfo` (`roleName`, `agentName`, `modelName?`, `effortName?`), preenchido nos três status para o canal exibir com qual agente, modelo e effort a resposta foi gerada;
- `attachments`: lista opcional de caminhos absolutos de arquivos locais existentes no disco extraídos da resposta final.

### `AgentSettings` (`agent-settings.model.ts`)

Configuração global de modelo e effort: `modelId`, `modelName`, `effortId`, `effortName` e
`updatedAt`. `effortId === null` indica modelo sem níveis de effort.

### `AgentConfigSelection` (`agent-config-selection.model.ts`)

Estado da seleção em andamento numa conversa: `channelId`, `threadId?`, `step`
(`'model' | 'effort'`), `options` numeradas (`SelectionOption`: `index`, `id`, `label`,
`description?`), `selectedModel?` e `pendingPrompt?`. Os desfechos dos use cases de seleção
estão em `agent-config-outcome.model.ts`.

## Portas do Orquestrador

As portas do orquestrador residem em `src/modules/orchestrator/ports/`:

### 1. `ISessionStorePort` (`session-store.port.ts`)

Responsável pela persistência e consulta do estado das sessões:

- `findSession(channelId: string, threadId?: string): Promise<SessionContext | null>`
- `saveSession(session: SessionContext): Promise<void>`
- Symbol homônimo: `export const ISessionStorePort = Symbol('ISessionStorePort');`

A implementação é o `JsonSessionStoreAdapter`, que grava `DATA_DIR/sessions.json`. Os specs
usam o `InMemorySessionStoreFake` de `testing/`.

### `IAgentSettingsStorePort` (`agent-settings-store.port.ts`)

`load(): Promise<AgentSettings | null>` e `save(settings): Promise<void>`. Implementado por
`JsonAgentSettingsStoreAdapter` em `DATA_DIR/agent-settings.json`.

### `IAgentConfigSelectionStorePort` (`agent-config-selection-store.port.ts`)

`find(channelId, threadId?)`, `save(selection)` e `remove(channelId, threadId?): Promise<boolean>`,
com chave `channelId:threadId`. Implementado em memória por
`InMemoryAgentConfigSelectionStoreAdapter`: uma seleção interrompida por reinício é descartada.

### Persistência em `DATA_DIR`

`resolveDataDirectory()` (`utils/data-directory.util.ts`) resolve, nesta ordem, o diretório
passado ao construtor, `process.env.DATA_DIR` e `./data`. Os adapters JSON carregam o arquivo
uma única vez, mantêm o conteúdo em memória, tratam arquivo ausente ou inválido como vazio e
serializam as escritas. O `JsonSessionStoreAdapter` carrega registro sem `agentSessions` com a lista vazia.

### 2. `IAgentRegistryPort` (`agent-registry.port.ts`)

Contrato para resolução de instruções comportamentais e especificações de modelo:

- `getSystemPrompt(agentRole: string): string`
- `getDefaultModel(agentRole: string): string | undefined`
- `getDefaultSessionMode(agentRole: string): 'resume' | 'new'`
- `getDisplayName(agentRole: string): string`: nome exibido no rodapé (o próprio papel quando desconhecido)
- `hasRole(agentRole: string): boolean`: valida o papel de uma delegação
- `getTurnReminder(agentRole: string): string`: lembrete mandatório injetado ao final de cada prompt do turno (sempre string)
- Symbol homônimo: `export const IAgentRegistryPort = Symbol('IAgentRegistryPort');`

A implementação é o `AgentRegistryService` do `AgentDefinitionsModule`, que resolve os
prompts completos de cada papel (`CEO`, `DEVELOPER`, `CODE_REVIEWER`), fornece lembretes de turno e devolve um prompt genérico para
papéis desconhecidos.

### 3. `ConversationRuntimeService` (`services/conversation-runtime.service.ts`)

Mantém em memória o estado de execução de cada conversa, identificada por
`buildConversationKey(channelId, threadId)` (`utils/conversation-key.util.ts`, formato
`channelId:threadId`). A chave é a conversa e não o `sessionId` porque a sessão só é resolvida
dentro da fila:

- **Agente da conversa**: um `IAgentPort` criado pela `IAgentPortFactory` na primeira execução e reutilizado nos turnos seguintes;
- **Ciclo de vida e concorrência**: `beginTurn(conversationKey)` rastreia `activeTurnsCount` e previne expiração prematura; `runOnCeo(conversationKey, work, onQueued)` garante exclusão mútua apenas no uso da porta do CEO, liberando-a enquanto agentes delegados rodam em segundo plano;
- **Fila de turnos do CEO**: turnos que chegam enquanto o CEO está ocupado chamam `onQueued` e aguardam a liberação da porta do CEO. Novas mensagens do usuário processam imediatamente pelo CEO mesmo com delegações ativas;
- **Delegações ativas**: `registerDelegation()`, `unregisterDelegation()`, `getActiveDelegations()` e `findActiveDelegation()` mantêm o registro de especialistas em execução em segundo plano;
- **Cancelamento**: `cancel(conversationKey)` cancela o `ActiveTurn` do CEO e todas as `activeDelegations` ativas da conversa. Devolve `false` quando não há trabalho em andamento;
- **Expiração por ociosidade**: sem turnos e sem delegações por `SESSION_IDLE_TIMEOUT_MS` (padrão 30 minutos), encerra todos os agentes (`closeSession` + `disconnect`). A `SessionContext` e suas `agentSessions` permanecem no store, e a mensagem seguinte retoma a sessão ACP com `loadSession`;
- **Shutdown**: `onApplicationShutdown` desconecta todos os agentes (CEO e delegados). Requer `app.enableShutdownHooks()` no bootstrap.

### 4. `DelegationDetectorService` (`services/delegation-detector.service.ts`)

Interpreta os marcadores da resposta do CEO e devolve uma `CeoDecision`. Um marcador vale quando
ocupa uma linha inteira, aceitando formatação markdown em volta (`` ` ``, `*`, `_`) e caixa
qualquer; o papel é normalizado para maiúsculas:

- `{ kind: 'delegate', delegation: { delegateToRole, projectName, taskSpec, sessionMode } }` para `[DELEGATE:ROLE:project]` ou com modificador de sessão `[DELEGATE:ROLE:project:new]` / `[DELEGATE:ROLE:new]` (`sessionMode?: 'resume' | 'new'`). `taskSpec` é a resposta sem a linha do marcador, incluindo o texto posterior a ele, já que os modelos às vezes escrevem a especificação depois do marcador;
- `{ kind: 'done', summary }` para `[DONE]`. `summary` é a resposta sem a linha do marcador;
- `{ kind: 'direct_response' }` quando a resposta não contém nenhum marcador;
- `{ kind: 'invalid', reason }` para marcador que divide a linha com texto, mais de um marcador, marcador malformado ou delegação sem `taskSpec`. `reason` é escrito em inglês para o CEO corrigir a resposta.

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

| Último marcador da resposta do CEO | Ação do orquestrador |
|---|---|
| `[DELEGATE:ROLE:project]` | Cria novo `IAgentPort` para `ROLE` com `cwd` no projeto, retoma ou inicia sessão conforme `sessionMode` / `defaultSessionMode` e envia `taskSpec` (prefixado com `systemPrompt(ROLE)` quando a sessão é criada) |
| `[DELEGATE:ROLE:project:new]` | Idem ao anterior, forçando sessão ACP nova (`sessionMode: 'new'`) sem reaproveitar histórico |
| `[DONE]` | Encerra o loop e devolve a resposta sem o marcador |
| *(nenhum)* | Encerra o loop e devolve a resposta integral do CEO |
| *(inválido)* | Envia ao CEO o prompt de reparo com o motivo |

A resposta classificada é o conteúdo do envelope `<final_response>`, extraído pelo demux, e por
isso os marcadores ficam na última linha dele. O prompt de reparo reforça essa regra.

O resultado do agente delegado volta ao CEO como `[AGENT_RESULT:ROLE]\n<resposta>`.

### Execução de Turno (`ExecuteAgentTurnUseCase`)

Injeta `@Inject(IAgentPortFactory)`, `@Inject(ISessionStorePort)`, `@Inject(IAgentRegistryPort)`,
`@Inject(IWorkspacePort)`, `@Inject(IAgentSettingsStorePort)`, `DelegationDetectorService` e
`ConversationRuntimeService`.

A execução do método `execute(request: TurnRequest): Promise<TurnResult>` segue a sequência:

1. **Ciclo de vida do Turno**: invoca `ConversationRuntimeService.beginTurn(conversationKey)`, garantindo rastreamento no contador de turnos ativos até o `finally`.
2. **Exclusão mútua do CEO**: executa a rodada do CEO via `ConversationRuntimeService.runOnCeo(conversationKey, ...)`. A porta do CEO é liberada assim que o CEO decide delegar, permitindo que novas mensagens do usuário sejam atendidas enquanto especialistas trabalham em segundo plano.
3. **Resolução de Sessão e Enriquecimento de Prompt**: resolvida na primeira rodada do CEO dentro de `runOnCeo` para que mensagens simultâneas compartilhem deterministicamente a mesma sessão persistida. Se houver `request.attachments`, enriquece o prompt com o bloco `[ATTACHMENTS]` detalhando o inventário local (nome, tamanho, tipo MIME e caminho absoluto no disco) e orientando o agente a usar `view_file` para inspecioná-los. Se houver delegações em andamento (`getActiveDelegations`), injeta o bloco `[ACTIVE_DELEGATIONS]` no prompt inicial do CEO.
4. **Loop de Delegação**: repete até `MAX_DELEGATION_ROUNDS` (10) rodadas:
   1. Executa o turno do CEO com `cwd = request.workspacePath`.
   2. Classifica a resposta com `DelegationDetectorService.detect()` e valida a delegação: o papel precisa existir (`hasRole`) e ser diferente do papel raiz, e o projeto precisa ser aceito por `resolveRepositoryPath`. Falhas de validação viram `invalid`.
   3. **Reparo**: em `invalid`, envia ao CEO `buildDelegationRepairPrompt(reason)` (`prompts/delegation-repair.prompt.ts`), iniciado por `[DELEGATION_ERROR]`, e classifica a nova resposta. São até `MAX_REPAIR_ATTEMPTS` (1) tentativas por resposta do CEO, fora da contagem de rodadas. Persistindo `invalid`, retorna `status: 'failed'` com `errorMessage: 'Invalid CEO response: <reason>'`.
   4. `direct_response` e `done` encerram com `status: 'completed'`.
   5. Em `delegate` na última rodada, encerra sem executar o delegado (item 4), porque o resultado não voltaria ao CEO.
   6. Nas demais rodadas, em `delegate`:
      - Quando o papel já possui delegação ativa (`findActiveDelegation`):
        - Se `existing.agentPort.supportsSteering === true`: aplica steering nativo chamando `await existing.steer(taskSpec)` e retorna imediatamente `[AGENT_RESULT:ROLE]\nSteering message sent to active agent.`.
        - Se `existing.agentPort.supportsSteering === false`: cancela a rodada ativa anterior (`await existing.turn.cancel()`), fecha a sessão e desconecta o transporte com tratamento tolerante a erros (`closeSession()`, `disconnect()`), remove do runtime e prossegue para inicializar nova porta no diretório solicitado, retomando a sessão ACP correspondente e aguardando a resposta consolidada do especialista.
      - Cria `ActiveDelegation` e registra no runtime. Se `delegatePort.supportsSteering === true`, o método `steer` despacha `sendSteeringPrompt`.
      - Registra `[Delegation Started]` e emite `onDelegation` `started`; ao concluir, registra `[Delegation Finished]` e emite `finished`.
   7. No `finally` da delegação, remove do registro de delegações ativas e encerra o agente delegado (`closeSession()` + `disconnect()`).
   8. O próximo prompt do CEO passa a ser `[AGENT_RESULT:ROLE]\n<resposta do delegado>`.
5. **Limite de Rodadas**: esgotadas as rodadas, retorna `status: 'failed'` com `errorMessage: 'Max delegation rounds exceeded.'`.

Cada turno de agente (CEO ou delegado) executa internamente:

1. Anexa o `getTurnReminder(role)` do papel ao prompt recebido.
2. `turn.activate(agentPort)` e `turn.throwIfCancelled()`.
3. `connect()` seguido de `turn.throwIfCancelled()`.
3. Se `currentSessionId` não estiver definido:
   1. **Com sessão do papel em `agentSessions` e `sessionMode !== 'new'`**: relê a `SessionContext` do store e chama `loadSession(cwd, sessionId)`. Com sucesso, o system prompt não é reenviado. A releitura é necessária porque o objeto do turno não reflete as sessões gravadas pelo CEO e por rodadas anteriores.
   2. **Sem ID, modo `'new'` ou load com falha**: `ensureDirectory(cwd)`, `createSession(cwd)` e prefixo do prompt com `getSystemPrompt(role)`. O system prompt acompanha a criação da sessão ACP, e não a da `SessionContext`, para que uma sessão recriada receba as instruções do papel.
   3. Se o ID da sessão ACP mudou, substitui a entrada do papel em `agentSessions` e salva no store.
4. Configuração: com `AgentSettings`, `setConfig({ modelId, effortId: effortId ?? undefined })`; sem settings, `setConfig({ modelId })` quando `getDefaultModel(role)` retorna modelo. Vale para o CEO e para os delegados.
5. Registro de `request.onActivity` via `onActivity(...)`, desfeito no `finally`. Atividades de todos os agentes fluem para o mesmo callback.
6. `turn.throwIfCancelled()` e drenagem de `prompt(text)`, despachando blocos `agent_message_chunk` para `request.onTextChunk`.
7. Resposta a partir de `lastAgentMessage` ou dos blocos acumulados, registrada no log como `[Agent Response] Role=<ROLE>, Length=<n>` com prévia de 100 caracteres em linha única.

**Tratamento de Cancelamento e Falhas**: `PromptCancelledError` (ou erro com nome
homônimo) lançado por qualquer agente ou pelo `ActiveTurn` retorna `status: 'cancelled'`. Demais
erros retornam `status: 'failed'` com `errorMessage` e desconectam o agente do CEO, para que o
turno seguinte suba um transporte novo e retome a sessão. Em ambos os casos, `response` recebe
o `lastAgentMessage` do CEO.

**Metadados do turno**: `agentInfo.roleName` vem de `getDisplayName(role)` e `agentName` do
`IAgentPort` do CEO. `modelName` e `effortName` vêm das `AgentSettings`; sem settings,
`modelName` é o `displayName` de `getAvailableModels().currentModelId`.

### Cancelamento de Turno (`CancelAgentTurnUseCase`)

Injeta `ConversationRuntimeService`.

O método `execute(channelId: string, threadId?: string): Promise<boolean>` aciona
`ConversationRuntimeService.cancel(buildConversationKey(channelId, threadId))` e devolve se havia
turno em andamento, inclusive num turno que ainda não salvou a sessão. O `PromptCancelledError`
resultante interrompe o loop de delegação.

## Seleção de Modelo e Effort

A escolha é global e persistida. `AgentCapabilitiesService` descobre as opções numa porta
descartável (`create()` → `connect()` → leitura → `disconnect()` no `finally`), isolada da
porta da conversa.

- **`StartAgentConfigSelectionUseCase`** `({ channelId, threadId?, pendingPrompt? })`: lista os modelos, salva `step: 'model'` e retorna `{ kind: 'selection', selection }`; sem modelos, `{ kind: 'unavailable' }`.
- **`SubmitAgentConfigSelectionUseCase`** `({ channelId, threadId?, input })`: aceita só `^\d+$` entre 1 e N; outra entrada retorna `invalid` sem mudar o estado. Na etapa `model`, avança para `effort` se o modelo tiver efforts, senão salva com `effortId: null`. Na etapa `effort`, salva. Ao salvar, remove a seleção e retorna `{ kind: 'configured', settings, pendingPrompt? }`.
- **`ResolveConversationInputUseCase`** `({ channelId, threadId?, prompt })`: com seleção ativa, delega para `Submit`; sem settings, delega para `Start` com `pendingPrompt` (`unavailable` vira `execute`); com settings, `execute`. Um `configured` com `pendingPrompt` vira `{ kind: 'execute', prompt: pendingPrompt, configured }`.
- **`CancelAgentConfigSelectionUseCase`**: remove a seleção e retorna se havia uma.

## Fachada de Serviço (`OrchestratorService`)

Interface do orquestrador para os canais:

- `executeTurn(request)` e `cancelTurn(channelId, threadId?)`;
- `resolveInput({ channelId, threadId?, prompt })`: decide entre executar o prompt ou conduzir a seleção;
- `startConfigSelection(channelId, threadId?)` e `cancelConfigSelection(channelId, threadId?)`;
- `hasActiveConfigSelection(channelId, threadId?)`.

## Regras Prescritivas Mandatórias

- **Proibido acoplamento com Discord ou canais de rede**: o orquestrador manipula unicamente identificadores (`channelId`, `userId`, `threadId`), sem importar discord.js, HTTP frameworks ou drivers de terceiros.
- **Portas e Symbols**: toda dependência externa aos use cases deve utilizar injeção por Symbol (`@Inject(ISessionStorePort)`).
- **Sem barrel exports**: nunca crie `index.ts` em `models/`, `ports/`, `adapters/`, `services/` ou `use-cases/`.
- **Limpeza de recursos reativos**: todo callback registrado em `onActivity` deve ser desconectado em bloco `finally`.
- **Uma sessão ACP por conversa**: obtenha instâncias de `IAgentPort` exclusivamente pela `IAgentPortFactory`. O agente do CEO de cada conversa vive no `ConversationRuntimeService`, e cada delegação usa uma instância descartável que retoma a sessão ACP do papel.
- **Sessão só com dados**: `SessionContext` guarda apenas dados serializáveis. Agentes vivos, fila e turno ativo ficam no `ConversationRuntimeService`, porque o store é persistido em disco.
- **Controle de concorrência e exclusão mútua do CEO**: todo turno registra seu ciclo de vida em `ConversationRuntimeService.beginTurn(conversationKey)`, e as interações com o CEO passam por `ConversationRuntimeService.runOnCeo(conversationKey, work)`. O CEO fica liberado durante a execução de delegados em segundo plano, mantendo o enfileiramento estrito de chamadas simultâneas na mesma porta do CEO para evitar chamadas paralelas a `prompt()`.
- **Delegação cancelável**: todo agente em execução deve ser registrado com `turn.activate(agentPort)`, e `turn.throwIfCancelled()` deve preceder `connect` e `prompt`.
- **Limite de rodadas**: mantenha `MAX_DELEGATION_ROUNDS` para impedir loops infinitos entre CEO e agentes delegados.
- **Não vazar exceções em execute()**: `ExecuteAgentTurnUseCase.execute()` deve devolver `TurnResult` com `status: 'failed'` ou `status: 'cancelled'`, nunca lançar erros descontrolados para a camada de apresentação.
