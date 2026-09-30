---
name: agent-port
description: >
  Padrão de integração com agentes de IA via Agent Client Protocol (ACP) e Ports &
  Adapters. Define o contrato IAgentPort, o ciclo de vida da sessão (connect,
  createSession, loadSession, prompt, cancel, closeSession), a retomada via session/load,
  a detecção de transporte perdido, a escada de cancelamento com e sem steering, o demux
  de streaming, a fábrica multi-agente e os adapters AntigravityAdapter e ClaudeCodeAdapter.
  Use ao implementar, estender ou consumir agentes, bridges ACP, processos e streams.
---

# Porta do Agente e Integração ACP

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é qual regra — é a natureza da mudança: o protocolo de comunicação, ciclo de vida
> de sessão ou contrato de agente mudou → atualize; ajuste cosmético interno que
> preserva as regras consolidadas → não toque.

## Contrato `IAgentPort`

A porta `IAgentPort` reside em `src/modules/agent/ports/agent.port.ts` e desacopla
o núcleo da aplicação dos detalhes técnicos de comunicação com agentes de IA.

Cada instância de `IAgentPort` representa um subprocesso de agente com uma única sessão
ACP. Consumidores obtêm instâncias pela fábrica `IAgentPortFactory`
(`src/modules/agent/ports/agent-port-factory.port.ts`), registrada no `AgentModule` com
`AcpAgentPortFactoryAdapter`:

```ts
@Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory

const agentPort = this.agentPortFactory.create('claude');
```

A fábrica expõe:

- `defaultAgentId: string`: agente usado enquanto não há escolha salva (`'agy'`);
- `listAgents(): readonly AgentProviderInfo[]`: catálogo (`agentId`, `displayName`) na ordem de exibição — `agy` (Antigravity) e `claude` (Claude Code);
- `create(agentId: string): IAgentPort`: instância nova do agente; lança `Unknown agent "<id>". Available agents: ...` para um ID fora do catálogo.

O `agentId` do catálogo é igual ao `agentName` da porta criada, e é por ele que o orquestrador
compara a porta viva com o agente escolhido.

O `AgentModule` exporta a fábrica e as portas de infraestrutura `IProcessRunnerPort` e
`IFileSystemPort`. Um `IAgentPort` singleton faria todas as conversas compartilharem a
mesma sessão ACP e o mesmo `cwd`.

### Propriedades

- `agentName: string`: identificador do agente concreto (`'agy'` ou `'claude'`), igual ao `agentId` da fábrica e exibido no rodapé das respostas.
- `lastAgentMessage: string`: última resposta textual consolidada do turno.
- `currentSessionId?: string`: ID da sessão ACP ativa. Fica `undefined` sem sessão, inclusive depois de transporte perdido ou cancelamento forçado.
- `supportsSteering: boolean`: indica se o agente suporta redirecionamento (steering) nativo durante a execução de um turno.

### Métodos

- `connect(): Promise<void>`: inicializa o transporte, lê as capacidades (`agentCapabilities.loadSession` e `_meta.steering.supported`) e descobre as opções de configuração. É idempotente. Se o handshake falhar, o subprocesso é encerrado e o estado limpo, permitindo nova tentativa.
- `createSession(cwd: string): Promise<void>`: cria uma sessão (`session/new`) vinculada ao diretório informado.
- `loadSession(cwd: string, sessionId: string): Promise<boolean>`: retoma uma sessão existente via `session/load`. Retorna `false`, sem lançar, quando o agente não anuncia `loadSession` ou quando o load falha; retorna `true` com `currentSessionId` definido.
- `prompt(text: string): AsyncGenerator<AgentUpdate>`: envia um turno e entrega o bloco final consolidado.
- `sendSteeringPrompt(text: string): Promise<boolean>`: injeta texto no prompt em andamento. Com steering, envia `_session/steering` com `_meta.steering.idleBehavior = 'promptRequired'` e resolve `true` só com `outcome: 'injected'`; sem prompt em andamento (`promptRequired`), sem sessão ou com erro, resolve `false` e o texto não é entregue, então o chamador decide o que fazer com ele. Sem steering, dispara `session/prompt` como fallback e resolve `true`.
- `cancel(): Promise<void>`: interrompe o prompt em andamento pela escada de cancelamento. Sem prompt em andamento é no-op, para que um cancelamento tardio não aborte o turno seguinte.
- `closeSession(): Promise<void>`: encerra a sessão ativa, preservando a conexão.
- `disconnect(): Promise<void>`: descarta a sessão, encerra o subprocesso e limpa as opções em cache.
- `getAvailableModels(): AgentModelState | null`: modelos publicados e o modelo ativo.
- `getAvailableEffortsForModel(modelId: string): Promise<AgentEffortState | null>`: níveis de effort do modelo, lidos numa sessão de sondagem isolada.
- `setConfig(config: AgentConfig): Promise<void>`: aplica modelo e/ou effort à sessão ativa e guarda como preferência para as próximas sessões.
- `getLastRoundUsage(): Promise<AgentUsage | undefined>`: consumo de tokens do último turno ou via fallback.
- `onActivity(listener): () => void`: observa o feed ao vivo (pensamentos, ferramentas e cancelamento).

### Tipos sem SDK

`AgentUpdate` é `{ kind: 'text'; text: string }` e `AgentToolStatus` é
`'pending' | 'in_progress' | 'completed' | 'failed'`. Nenhum tipo do
`@agentclientprotocol/sdk` aparece na porta; o SDK só é importado em
`src/modules/agent/{adapters,bridges,demux,testing}`.

## Ciclo de Vida da Sessão

```text
connect() ──> loadSession(cwd, id) ──false──> createSession(cwd) ──> prompt(text) ──> closeSession() ──> disconnect()
                     │                                                 │      ▲
                     └──────────────────true───────────────────────────┘      └── cancel()
```

### Retomada com `session/load`

O SDK só monta `ActiveSession` para `session/new`. A sessão carregada usa o
`ResumedSession` (`adapters/resumed-session.ts`), que implementa o mesmo `SessionHandle`
(`sessionId`, `prompt`, `nextUpdate`, `dispose`): recebe os updates pelo handler global de
`session/update` e envia o prompt direto por `session/prompt`. O handle só é criado depois
da resposta do `session/load`, o que descarta o histórico reenviado pelo agente antes dela.

Depois de criar ou carregar a sessão, o adapter aplica as `configOptions` retornadas, os
`sessionConfigPresets()` e a preferência de `setConfig`.

### Transporte perdido

O `connect()` registra `exit` e `error` no subprocesso. Quando um deles dispara, o adapter
loga `agent_process_exited`, descarta a sessão e o transporte e zera `currentSessionId`; um
prompt em andamento falha com erro de transporte. O `disconnect()` remove esses listeners
antes de encerrar o processo, então o próprio encerramento não é tratado como queda. O
próximo `connect()` sobe um processo novo.

### Escada de cancelamento

1. **Notificação imediata**: envia `session/cancel` e abre janela de 5 segundos.
2. **Escalação**: com steering, injeta o prompt de abort (`CANCEL_ABORT_PROMPT_TEXT`) por `_session/steering`; sem steering, reenvia `session/cancel`, porque um `session/prompt` concorrente seria rejeitado pelo agente ocupado. Abre janela de 15 segundos.
3. **Cancelamento forçado**: rejeita localmente o turno com `PromptCancelledError` e descarta a sessão e o transporte. O turno seguinte reconecta e retoma a sessão com `loadSession`.

## Demux de Streaming e Atividades

O `AgentStreamDemux` decompõe as notificações brutas do ACP em eventos tipados:

- `agent_thought_chunk`: atividades `{ kind: 'thought', id, text }`.
- `tool_call` e `tool_call_update`: atividades `{ kind: 'tool', toolCallId, title, status, details? }`. Os detalhes da ferramenta (argumentos, parâmetros de execução, saída ou erros) são extraídos integralmente do payload ACP sem truncamento prematuro.
- `agent_message_chunk`: narrado como atividade `thought` e acumulado; no fechamento do `prompt()` vira o bloco final `AgentUpdate`. Respostas vazias não geram bloco.

A resposta final é a mensagem que contém `<final_response>` (`constants/final-response.constant.ts`,
ignorado em `agent_thought_chunk`). Quando esse envelope aparece, a entrada da mensagem no feed é
fechada com a prosa anterior a ele (`final: true`) ou removida (`removed: true`) quando não há prosa,
e a mensagem deixa de ser narrada. `takeFinalText()` e `lastAgentMessage` devolvem só o conteúdo dos
envelopes (`splitFinalResponse`), que aceita envelope sem fechamento. Sem envelope, o texto final
junta todas as mensagens que não são thought, o que cobre sessões retomadas de antes do envelope.

## Adaptadores ACP

A classe base `AbstractAcpAdapter` implementa o protocolo ACP, as sessões e a integração
com o demux. Ela também provê `buildAgentEnv(cwd)`, o ambiente isolado de todo subprocesso de
agente: credenciais e configuração da aplicação hospedeira (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
`WORKSPACE_DIR`, `DATA_DIR`, `SESSION_IDLE_TIMEOUT_MS`, `PORT`), as variáveis que revelam o
diretório da aplicação (`PWD`, `OLDPWD`, `INIT_CWD`, `PROJECT_CWD`) e as do prefixo `npm_` ficam de
fora, e `PWD` é reescrito com o `cwd` do subprocesso. O restante do ambiente segue adiante, porque o
agente depende dele para operar (`PATH`, `HOME`, `SSH_AUTH_SOCK`, credenciais do próprio agente).

Os `sessionConfigPresets()` de um adapter são aplicados a toda sessão criada ou carregada, por
categoria de opção (`model`, `thought_level`, `mode`, `permissions`). Um preset cujo valor o agente
não publica é registrado em log e ignorado.

### `AntigravityAdapter`

O `AntigravityAdapter` (`agentName = 'agy'`) herda de `AbstractAcpAdapter` e provê:

- Resolução do binário do bridge (`agy-acp-bridge.js` compilado ou `agy-acp-bridge.ts` em desenvolvimento).
- Execução do bridge como subprocesso via `IProcessRunnerPort.spawn`, em `tmpdir()`, com `buildAgentEnv`. O bridge sobe no `connect()`, antes de a sessão existir, então não há `cwd` de sessão a adotar.

O diretório onde o agente trabalha é o `cwd` da sessão, e não o do bridge: `createSession(cwd)` e `loadSession(cwd, id)` recebem o caminho, e o bridge sobe cada processo `agy` nele, com `PWD` alinhado.

O bridge `agy-acp-bridge.ts` anuncia `loadSession: true`. O `session/load` reinicia o `agy`
com `--conversation <sessionId>` e adota esse ID; o histórico fica guardado no próprio agy e
não é reenviado. Se o evento `init` trouxer outro `conversation_id`, o agy abriu uma conversa
nova: o bridge encerra o processo e rejeita o `session/load`, e o orquestrador cria e persiste
uma sessão nova. O bridge expõe apenas a opção `model` (sem `thought_level`).

Cada processo `agy` é uma execução (`AgyRun`) que guarda o próprio prompt pendente. Eventos
`result`, `step_update` e `exit` de um processo só encerram o prompt dele. O `session/cancel`
envia `SIGINT` e marca a execução como interrompida; o próximo prompt sobe um processo novo
com `--conversation`, mesmo que o anterior ainda não tenha saído, e o processo interrompido
recebe `SIGTERM`. Assim, um `exit` atrasado do processo antigo não cancela nem rejeita o prompt
novo.

### `ClaudeCodeAdapter`

O `ClaudeCodeAdapter` (`agentName = 'claude'`) integra o Claude Code CLI pelo adaptador ACP oficial
`@agentclientprotocol/claude-agent-acp` (dependência do projeto), sem bridge próprio:

- Executa `node <claude-agent-acp>/dist/index.js`, resolvido com `createRequire(import.meta.url)`, em `tmpdir()` e com `buildAgentEnv`.
- Define `CLAUDE_CODE_EXECUTABLE` com o `claude` do `PATH` (`IFileSystemPort.resolveInPath('claude')`), descartando valor herdado do ambiente, para o Claude Agent SDK usar o CLI instalado e autenticado pelo usuário. Sem `claude` no `PATH`, o SDK usa o binário embutido.
- Preset de sessão `mode = bypassPermissions`: ninguém responde pedidos de permissão numa sessão remota. O Claude Code não oferece esse modo para processo `root` sem `IS_SANDBOX=1`; nesse caso a sessão segue no modo padrão do usuário e os pedidos de permissão são aprovados pelo handler do `AbstractAcpAdapter`.
- O agente anuncia `loadSession` e `_meta.steering.supported`, então retomada, steering (`_session/steering`) e a escada de cancelamento com steering valem sem código específico. O `session/load` reenvia o histórico antes de responder e não restaura modelo, effort nem modo; o `applySessionConfig` do adapter base os reaplica.
- As opções publicadas são `model` (aliases como `opus`, `sonnet`, `haiku` e IDs completos), `effort` (categoria `thought_level`, ausente em modelos sem effort, como `haiku`), `mode` e `fast`. Os efforts dependem do modelo e são lidos pela sessão de sondagem de `getAvailableEffortsForModel`.
- A sessão carrega as configurações do usuário do Claude Code (`~/.claude/settings.json`, `CLAUDE.md`, hooks, skills), já que o SDK roda com `settingSources` de usuário, projeto e local.

## Regras Prescritivas

- **Proibido instanciar adaptadores diretamente em casos de uso**: obtenha instâncias via `@Inject(IAgentPortFactory)` e `create(agentId)`.
- **Novo agente entra pela fábrica**: um adapter novo herda de `AbstractAcpAdapter`, usa `buildAgentEnv` no spawn e é registrado no catálogo do `AcpAgentPortFactoryAdapter` com `agentId` igual ao seu `agentName`.
- **Proibido acoplar o núcleo ao SDK do ACP**: casos de uso manipulam exclusivamente os tipos de `agent.port.ts`.
- **Isolamento de I/O em adaptadores concretos**: sistema de arquivos e processos passam por `IFileSystemPort` e `IProcessRunnerPort`.
- **Limpeza de recursos obrigatória**: garanta `closeSession()` ou `disconnect()` em blocos `finally` ou no descarte de recursos de orquestração.
