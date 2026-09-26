---
name: discord-bot
description: >
  Bot do Discord como adaptador primário de entrada para agentes de IA. Governa os
  comandos /model e /cancel, a seleção numerada de modelo/effort, o rodapé de agente
  nas respostas, o registro de slash commands por guilda ou global, o cliente e intents,
  threads por conversa, streaming de atividades, throttling contra 429 e particionamento
  em 2000 caracteres. Use ao trabalhar com mensagens, interações, formatação ou eventos
  do Discord.
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
- **Registro de Comandos Slash**: No hook `onApplicationBootstrap`, registra `/cancel` e `/model`. Com `DISCORD_GUILD_ID` e a guilda encontrada, registra só na guilda e limpa os comandos globais (`application.commands.set([])`), porque o Discord exibiria cada comando duplicado. Sem a variável, ou com a guilda não encontrada, registra só globalmente.
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
     se o bot for mencionado no corpo da mensagem ou se houver seleção de modelo aberta na
     thread (`hasActiveConfigSelection(parentId, threadId)`, aberta por `/model` numa thread
     que não é do bot).
   - Mensagens sem menção em canal comum são sempre ignoradas. A seleção de `/model` num canal
     comum acontece numa thread do bot, então nenhuma conversa solta do canal é tratada como
     resposta.
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

## Resolução da Entrada e Seleção de Modelo

Antes de executar o turno, o handler chama `OrchestratorService.resolveInput({ channelId, threadId, prompt })`:

- `selection`: envia `formatSelection` (lista numerada de modelos ou de efforts) e encerra;
- `invalid`: envia `formatInvalidSelection` (faixa válida seguida da lista) e encerra;
- `configured`: envia `formatConfigured` e encerra;
- `execute`: se trouxer `configured`, envia a confirmação e executa o `prompt` resolvido (o prompt pendente da primeira mensagem).

A seleção começa sozinha na primeira mensagem enquanto não houver configuração salva, e é
reaberta com `/model`. O estado fica por conversa (canal + thread).

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

Uma exceção durante o processamento da mensagem é informada com
`❌ **Ocorreu um erro ao processar sua solicitação:** <mensagem>`, também particionada; se esse
envio falhar, a falha só é registrada em log.

## Streaming de Atividades e Formatação

Durante a execução do turno, atividades do agente são capturadas via callback `onActivity`
e formatadas pelo `DiscordActivityFormatter`:

- **Pensamentos (`thought`)**: formatados como bloco de citação do Discord com emoji:
  `> 💭 *<texto>*`.
- **Ferramentas (`tool`)**:
  - Em andamento: `⏳ **Executando**: \`<title>\``;
  - Sucesso: `✅ **Concluído**: \`<title>\``;
  - Falha: `❌ **Falhou**: \`<title>\``.
- **Mensagem de progresso**: as atividades são agrupadas em uma mensagem de progresso dedicada
  na thread, mantida pelo `ActivityFeed` (`utils/activity-feed.util.ts`):
  - Atividades são *upserts* por chave (`thought:<id>`, `tool:<toolCallId>`). Um `thought` chega
    com o texto acumulado a cada chunk e um `tool` a cada mudança de status; ambos atualizam a
    própria entrada. `thought` com `removed` remove a entrada; o demux remove assim a mensagem que
    carrega o envelope `<final_response>`, para que a resposta final não apareça também no progresso.
  - `render(header)` exibe as 8 entradas mais recentes que couberem em 2000 caracteres
    (limite de conteúdo do Discord), preservando o final de uma entrada maior que o limite.
  - O log registra cada `thought` uma única vez, ao receber `final`.
- **Delegação**: `onDelegation` encerra a mensagem de progresso atual com o estado final do
  feed, envia o aviso de `formatDelegation(event)` e abre uma nova mensagem de progresso com feed
  vazio. No `started`, o aviso diz qual agente assumiu (e o projeto) e o cabeçalho vira
  `formatDelegateProgressHeader(roleName)`; no `finished`, o aviso diz que o CEO está revisando e o
  cabeçalho volta a `🤖 **Progresso do Agente**:`. Esses envios são encadeados na ordem dos
  eventos, e o handler aguarda a cadeia antes do `flush()` final. Se o envio falhar, o progresso
  segue na mensagem anterior.

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

- **/cancel**: localiza o canal e a thread da interação, chama `cancelConfigSelection` e depois `cancelTurn`. Com turno em andamento, responde `🛑 **Cancelamento solicitado.** O turno ativo será interrompido.`; só com seleção encerrada, `🛑 **Seleção de modelo cancelada.**`; sem nenhum dos dois, `ℹ️ Não há nenhum turno em andamento para cancelar.` A resposta é efêmera.
- **/model**: `deferReply()` público. As opções são respondidas por mensagem na conversa, por isso a resposta é pública:
  - Em canal de guilda: `editReply('🧵 Escolha o modelo na thread abaixo.')`, thread criada a partir desse aviso (`startThread({ name: 'Seleção de modelo', autoArchiveDuration: 60 })`), `startConfigSelection(channelId, thread.id)` e `formatSelection` particionado dentro da thread. A thread é do bot, então as respostas entram sem menção e, depois de configurar, ela segue como uma conversa normal. Se a thread não puder ser criada, responde `❌ **Falha ao abrir a seleção de modelo**: <erro>`.
  - Em DM ou thread: `startConfigSelection` com a chave da conversa atual e `editReply(formatSelection)`.
  - Com `unavailable`, publica `ℹ️ O agente atual não expõe modelos para seleção.` no mesmo destino das opções.
- **Respostas protegidas**: toda resposta passa por um único método que usa `editReply` quando a interação foi adiada, `followUp` quando já respondida e `reply` nos demais casos, e apenas loga falhas de envio. O listener de `InteractionCreate` encadeia `.catch(...)` com log, e `main.ts` registra `process.on('unhandledRejection')` como rede de segurança: uma rejeição sem tratamento derrubaria o processo.
