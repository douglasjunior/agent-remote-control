---
name: discord-bot
description: >
  Bot do Discord como adaptador primário de entrada para agentes de IA. Governa os
  comandos /agent, /model e /cancel, a seleção numerada de agente/modelo/effort, o rodapé
  de agente nas respostas, o registro de slash commands por guilda ou global, o cliente e intents,
  threads por conversa, streaming de atividades, indicador de digitação com watchdog,
  throttling contra 429 e particionamento em 2000 caracteres. Use ao trabalhar com mensagens,
  interações, formatação ou eventos do Discord.
---

# Integração com Bot do Discord

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é *qual* regra — é a natureza da mudança: uma diretriz ou convenção do bot do Discord
> mudou → atualize; refator técnico que preserva o padrão descrito → não toque.

O módulo `DiscordModule` reside em `src/modules/discord/` e atua como a primeira porta
de entrada primária (*driving adapter*) do sistema. Ele escuta mensagens e interações,
direciona prompts ao orquestrador com a persona inicial `'CEO'`, transmite atividades
em tempo real e entrega a resposta final consolidada na thread correspondente.

## Gateway Intents e Ciclo de Vida do Cliente

O gerenciamento do cliente `Client` do `discord.js` é centralizado em `DiscordClientService`:

- **Intents obrigatórios**:
  - `GatewayIntentBits.Guilds`: resolução de servidores e canais;
  - `GatewayIntentBits.GuildMessages`: recepção de mensagens em canais de texto e threads;
  - `GatewayIntentBits.MessageContent`: leitura do conteúdo textual das mensagens (Privileged Intent no Discord Developer Portal);
  - `GatewayIntentBits.DirectMessages`: recepção de mensagens diretas e privadas (DM).
- **Partials obrigatórios**:
  - `Partials.Channel` e `Partials.Message`: garantem recepção de eventos em canais de DM não cacheados previamente.
- **Permissões do Bot (Permissions Integer)**:
  - O conjunto padrão de permissões de texto e canais totaliza o inteiro `380104727616` na calculadora de permissões do Discord.
- **Registro de Comandos Slash**: No hook `onApplicationBootstrap`, registra `/cancel`, `/model` e `/agent`. Com `DISCORD_GUILD_ID` e a guilda encontrada, registra só na guilda e limpa os comandos globais (`application.commands.set([])`), porque o Discord exibiria cada comando duplicado. Sem a variável, ou com a guilda não encontrada, registra só globalmente.
- **Tolerância a ausência de token**: Se a variável `DISCORD_BOT_TOKEN` não estiver definida
  no ambiente, o serviço deve emitir um aviso via `Logger.warn` e não lançar exceções.
  A aplicação deve inicializar normalmente em ambientes de CI e testes unitários.
- **Encerramento limpo**: No hook `onApplicationShutdown`, invoque `client.destroy()` para
  fechar conexões de WebSocket ativas com a API do Discord. O hook só roda com
  `app.enableShutdownHooks()` em `main.ts`.

## Modos de Interação Conversacional

### 1. Mensagens Diretas / Particular (DM)
- Mensagens originadas em DM (`message.channel.isDMBased()`) são processadas diretamente sem necessidade de menção `@Bot`.
- Não cria threads (o Discord não suporta threads em DMs); utiliza o próprio canal da DM para exibir progresso e enviar respostas.
- Mapeia `channelId = message.channelId` e `threadId = undefined` para o orquestrador.

### 2. Canais de Servidor com Isolamento em Threads
Para manter os canais limpos e conversas simultâneas estritamente isoladas:

1. **Filtro de mensagens**: Mensagens originadas de bots (`message.author.bot`) devem ser
   descartadas imediatamente.
2. **Critério de acionamento**:
   - Em canais normais de guilda: o bot só responde quando for explicitamente mencionado
     (`message.mentions.has(clientUser, { ignoreEveryone: true, ignoreRoles: true })`).
     As opções padrão do discord.js contam `@everyone`, `@here` e menções de cargo, o que
     faria qualquer anúncio no servidor abrir uma sessão de agente.
   - Em DM: toda mensagem é aceita.
   - Em threads: responde se a thread for gerenciada pelo bot (`channel.ownerId === clientUser.id`),
     se o bot for mencionado no corpo da mensagem ou se houver seleção de configuração aberta na
     thread (`hasActiveConfigSelection(parentId, threadId)`, aberta por `/agent` ou `/model` numa
     thread que não é do bot).
   - Mensagens sem menção em canal comum são sempre ignoradas. A seleção de `/agent` ou `/model`
     num canal comum acontece numa thread do bot, então nenhuma conversa solta do canal é tratada
     como resposta.
3. **Criação de thread**: Ao receber uma menção em canal normal, o handler cria uma nova
   thread a partir da mensagem (`message.startThread({ name, autoArchiveDuration: 60 })`).
   O título da thread utiliza os primeiros 50 caracteres do prompt.
4. **Resolução de IDs para o Orquestrador**: `resolveConversationKey(channelId, channel)`
   (`utils/conversation-key.util.ts`), compartilhado com o `DiscordInteractionHandler`:
   - `channelId`: o ID do canal pai da thread (`thread.parentId ?? thread.id`), ou o próprio canal fora de threads;
   - `threadId`: o ID da própria thread, ausente em DM;
   - `userId`: o identificador do autor da mensagem;
   - `agentRole`: invariavelmente `'CEO'` para triagem e orquestração inicial.
5. **Fila**: mensagens de uma conversa com turno em andamento aguardam na fila do
   orquestrador. Via `onQueued`, a mensagem de progresso exibe
   `⏳ *Aguardando a tarefa anterior desta conversa terminar...*`.

## Resolução da Entrada e Seleção de Agente e Modelo

Antes de executar o turno, o handler chama `OrchestratorService.resolveInput({ channelId, threadId, prompt })`
dentro de `DiscordTypingIndicator.during(canal, ...)`, porque responder uma seleção sobe um agente
descartável para listar modelos ou efforts e leva alguns segundos:

- `selection`: envia `formatSelection` (lista numerada de agentes, modelos ou efforts) e encerra;
- `invalid`: envia `formatInvalidSelection` (faixa válida seguida da lista) e encerra;
- `configured`: envia `formatConfigured` e encerra;
- `execute`: se trouxer `configured`, envia a confirmação e executa o `prompt` resolvido (o prompt pendente da primeira mensagem).

A seleção começa sozinha na primeira mensagem enquanto não houver configuração salva, e é
reaberta com `/agent` (a partir do agente) ou `/model` (modelo e effort do agente atual). O
estado fica por conversa (canal + thread).

O cabeçalho de `formatSelection` depende do passo (`AgentConfigSelection.step`):

- `agent`: `🤖 **Escolha o agente** respondendo com o número da opção:`;
- `model`: `🧠 **Escolha o modelo do <selectedAgent.name>** respondendo com o número da opção:`,
  ou `🧠 **Escolha o modelo do agente** ...` sem `selectedAgent`;
- `effort`: `⚡ **Escolha o effort para <selectedModel.name>** respondendo com o número da opção:`.

`formatConfigured(settings)` confirma com `✅ **Configuração salva**: 🤖 <agentName> · 🧠 <modelName> · ⚡ <effortName>`,
com `padrão` quando o modelo ou o effort são nulos.

## Rodapé das Respostas

Todo desfecho de turno com `TurnResult.agentInfo` recebe o rodapé
`formatAgentFooter(info, usage?)`: `-# 🤖 <papel> (<agente>) · 🧠 <modelo> · ⚡ <effort>`, com `padrão`
quando o modelo ou o effort não são conhecidos. Com `TurnResult.usage`, o rodapé termina em
`· 🪙 <total> tokens`, abreviado em `k`/`M`.

Todo desfecho é particionado com `splitMessage(texto, 2000 - footer.length - 1)`, e o rodapé vai
numa nova linha do último chunk. Isso vale também para a falha, porque o `errorMessage` pode
trazer o stderr completo do agente:

- **Concluído**: o texto é a resposta; sem texto, `✅ *Tarefa concluída sem mensagem de resposta.*`.
- **Cancelado**: `⚠️ **Turno cancelado pelo usuário.**`.
- **Falha**: `❌ **Erro na execução**: <errorMessage>`.

Quando `TurnResult.attachments` contiver arquivos locais existentes, eles são enviados no parâmetro `files` da última mensagem enviada.

## Recepção e Armazenamento de Anexos

O bot aceita arquivos anexados diretamente nas mensagens do Discord através de `DiscordAttachmentService`:

- **Mensagens apenas com anexos**: Mensagens sem texto mas com anexos são processadas normalmente com o prompt padrão `O usuário enviou anexos. Analise os arquivos anexados.`, sem descarte por "Empty Prompt".
- **Validação prévia de compatibilidade**:
  - Aceita múltiplos formatos legíveis pelas ferramentas do agente (imagens `.png`, `.jpg`, `.webp`, `.gif`, documentos `.pdf`, textos e código `.txt`, `.md`, `.json`, `.ts`, `.py`, etc., áudio, vídeo e arquivos de configuração como `Dockerfile` e `.env`).
  - Limite máximo de 100 MB por anexo.
  - Bloqueia arquivos binários executáveis ou não analisáveis (`.exe`, `.bin`, `.dll`, `.so`, `.zip`, etc.). Ao identificar arquivo incompatível, interrompe o fluxo imediatamente e envia aviso amigável no canal antes de iniciar o turno.
- **Armazenamento temporário seguro**:
  - Anexos válidos são baixados da CDN do Discord para diretório temporário do sistema operacional (`os.tmpdir()/agent-remote-control/attachments/<conversationKey>`).
  - Higienização contra *path traversal* via `path.basename` e prefixo único com timestamp e identificador aleatório.
  - Encaminhamento estruturado como `TurnAttachment[]` no campo `attachments` de `TurnRequest` ao invocar `orchestratorService.executeTurn`.

Uma exceção durante o processamento da mensagem é informada com
`❌ **Ocorreu um erro ao processar sua solicitação:** <mensagem>`, também particionada; se esse
envio falhar, a falha só é registrada em log.

## Streaming de Atividades e Formatação

Durante a execução do turno, atividades do agente são capturadas via callback `onActivity`
e formatadas pelo `DiscordActivityFormatter`:

- **Pensamentos (`thought`)**: entregues de forma integral (sem limite de 5 linhas), formatados como bloco de citação do Discord com emoji (`> 💭 *<texto>*`), particionados em blocos de até 2.000 caracteres via `splitMessage`. Atualizações em tempo real são sincronizadas no canal substituindo/editando as mensagens existentes via `DiscordThrottler` (intervalo de 1.500ms contra rate limits 429).
- **Ferramentas (`tool`)**: cada chamada de ferramenta gera mensagens individuais na thread:
  - No início (`in_progress`): envia mensagem `⏳ **Executando**: \`<title>\``.
  - Na conclusão (`completed` ou `failed`): edita essa mesma mensagem para `✅ **Concluído**: \`<title>\`` ou `❌ **Falhou**: \`<title>\``, acompanhada de bloco de código com até 5 linhas de detalhes (argumentos ou saída). Se os detalhes tiverem mais de 5 linhas, exibe as 5 primeiras seguidas por `... (+N linhas)`.
- **Delegação**: `onDelegation` libera o throttler pendente (`flush()`), envia o anúncio de `formatDelegation(event)` na ordem dos eventos. No `started`, o aviso diz qual agente assumiu, com nome e papel (ex.: `DEVELOPER`), e o projeto; no `finished`, a resposta do delegado é publicada com `formatDelegateResult(event)` e o rodapé `formatDelegateFooter(event)` (o mesmo de `formatAgentFooter` com agente, modelo, effort e tokens do delegado, mais `· ⏱️ <duração>`), particionada como as respostas finais, e o aviso diz que o CEO está revisando. Se o anúncio falhar, o erro é registrado em log e o fluxo prossegue.

## Indicador de Digitação e Watchdog de Inatividade

Durante a execução de um turno em `DiscordMessageHandler`, o feedback visual de digitação ("digitando...") é gerenciado por `DiscordTypingIndicator` (`utils/discord-typing-indicator.util.ts`):

- **Disparo inicial e repetição periódica**: ao iniciar o processamento de um turno, `start()` dispara `sendTyping()` imediatamente no canal e agenda repetições a cada `8000ms` (padrão de `intervalMs`). Rejeições e exceções em `sendTyping()` são suprimidas silenciosamente.
- **Watchdog de inatividade e keepalive**: um timer de inatividade configurado para 5 minutos (padrão de `idleTimeoutMs`) interrompe os disparos caso nenhuma atividade seja registrada. Os callbacks `onActivity` e `onDelegation` chamam `keepAlive()`, reiniciando a contagem do watchdog a cada nova atividade.
- **Espera curta**: `DiscordTypingIndicator.during(canal, work)` mantém a digitação enquanto `work` roda e chama `stop()` no `finally`, para esperas fora de um turno, como a consulta de agentes, modelos e efforts de uma seleção.
- **Encerramento no ciclo de vida**: `stop()` cancela os timers de repetição e de inatividade. O método é invocado em bloco `finally` logo após `executeTurn`, garantindo encerramento em conclusões com sucesso, cancelamentos e falhas.

## Throttling e Coalescing contra Rate Limit (HTTP 429)

A API do Discord impõe restrições severas de taxa para edição de mensagens (aproximadamente
1 edição por segundo por canal). Atualizações diretas a cada evento gerador levariam a erros 429:

- Utilize `DiscordThrottler` com intervalo mínimo de 1000ms a 1500ms entre requisições de edição.
- Chamadas intermediárias enquanto uma requisição estiver em trânsito são agregadas (*coalesced*),
  mantendo apenas o estado mais recente.
- Ao concluir o turno, execute obrigatoriamente `await throttler.flush()` para garantir que
  a última atualização de status seja enviada antes da resposta final.
- Destrua o throttler via `throttler.destroy()` ao término do ciclo.

## Particionamento de Respostas (`splitMessage`)

Mensagens no Discord possuem limite rígido de 2000 caracteres. Textos que excedam esse limite
são particionados por `DiscordActivityFormatter.splitMessage(content, maxLength)`:

- Divide o conteúdo respeitando quebras de linha (`\n`).
- Preserva blocos de código Markdown (\`\`\`): quando um bloco de código precisa ser dividido
  entre mensagens, a mensagem corrente deve fechar o bloco com \`\`\` e a mensagem seguinte
  deve reabrir o bloco com \`\`\`<lang> para preservar a formatação sintática no cliente.
- Nenhuma parte individual gerada pode ultrapassar o limite de `maxLength`. Cada linha só entra
  na parte corrente se couber junto com a cerca de fechamento que o bloco ainda exigirá após
  ela, e linhas maiores que o espaço disponível são fatiadas pelo mesmo mecanismo, preservando
  o estado do bloco de código entre as fatias.

## Interações e Comandos de Barra

Comandos de barra são interceptados por `DiscordInteractionHandler`:

- **/cancel**: localiza o canal e a thread da interação, chama `cancelConfigSelection` e depois `cancelTurn`. Com turno em andamento, responde `🛑 **Cancelamento solicitado.** O turno ativo será interrompido.`; só com seleção encerrada (de agente, modelo ou effort), `🛑 **Seleção cancelada.**`; sem nenhum dos dois, `ℹ️ Não há nenhum turno em andamento para cancelar.` A resposta é efêmera.
- **/model**: `deferReply()` público. As opções são respondidas por mensagem na conversa, por isso a resposta é pública:
  - Em canal de guilda: `editReply('🧵 Escolha o modelo na thread abaixo.')`, thread criada a partir desse aviso (`startThread({ name: 'Seleção de modelo', autoArchiveDuration: 60 })`), `startConfigSelection(channelId, thread.id)` com o indicador de digitação na thread (`DiscordTypingIndicator.during`) e `formatSelection` particionado dentro da thread. A thread é do bot, então as respostas entram sem menção e, depois de configurar, ela segue como uma conversa normal. Se a thread não puder ser criada, responde `❌ **Falha ao abrir a seleção de modelo**: <erro>`.
  - Em DM ou thread: `startConfigSelection` com a chave da conversa atual e `editReply(formatSelection)`; a resposta adiada já exibe "pensando..." durante a consulta.
  - Com `unavailable`, publica `ℹ️ O agente atual não expõe modelos para seleção.` no mesmo destino das opções.
- **/agent**: mesmo fluxo de `/model`, com `startAgentSelection(channelId, threadId?)`, que abre a seleção no passo `agent`; escolhido o agente, seguem modelo e effort pela mesma resposta numerada. Em canal de guilda o aviso é `🧵 Escolha o agente na thread abaixo.` e a thread se chama `Seleção de agente`. A falha responde `❌ **Falha ao abrir a seleção de agente**: <erro>` e `unavailable` publica `ℹ️ Nenhum agente disponível para seleção.`
- **Respostas protegidas**: toda resposta passa por um único método que usa `editReply` quando a interação foi adiada, `followUp` quando já respondida e `reply` nos demais casos, e apenas loga falhas de envio. O listener de `InteractionCreate` encadeia `.catch(...)` com log, e `main.ts` registra `process.on('unhandledRejection')` como rede de segurança: uma rejeição sem tratamento derrubaria o processo.
