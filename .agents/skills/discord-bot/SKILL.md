---
name: discord-bot
description: >
  Integração do Bot do Discord como adaptador primário de entrada para controle remoto
  de agentes de IA. Governa o ciclo de vida do cliente Discord, intents de gateway,
  isolamento de conversas em threads, streaming de pensamentos e ferramentas, controle
  de taxa contra erro 429, particionamento de mensagens no limite de 2000 caracteres
  e comando /cancel. Use ao trabalhar com mensagens, interações, formatação de
  atividades ou eventos do Discord.
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
  - `GatewayIntentBits.DirectMessages`: suporte futuro a comandos em mensagens diretas.
- **Tolerância a ausência de token**: Se a variável `DISCORD_BOT_TOKEN` não estiver definida
  no ambiente, o serviço deve emitir um aviso via `Logger.warn` e não lançar exceções.
  A aplicação deve inicializar normalmente em ambientes de CI e testes unitários.
- **Encerramento limpo**: No hook `onApplicationShutdown`, invoque `client.destroy()` para
  fechar conexões de WebSocket ativas com a API do Discord.

## Isolamento Conversacional com Threads

Para manter os canais limpos e conversas simultâneas estritamente isoladas:

1. **Filtro de mensagens**: Mensagens originadas de bots (`message.author.bot`) devem ser
   descartadas imediatamente.
2. **Critério de acionamento**:
   - Em canais normais de guilda: o bot só responde quando for explicitamente mencionado
     (`message.mentions.has(clientUser)`).
   - Em threads: responde se a thread for gerenciada pelo bot (`channel.ownerId === clientUser.id`)
     ou se o bot for mencionado no corpo da mensagem.
3. **Criação de thread**: Ao receber uma menção em canal normal, o handler cria uma nova
   thread a partir da mensagem (`message.startThread({ name, autoArchiveDuration: 60 })`).
   O título da thread utiliza os primeiros 50 caracteres do prompt.
4. **Resolução de IDs para o Orquestrador**:
   - `channelId`: o ID do canal pai da thread (`thread.parentId ?? thread.id`);
   - `threadId`: o ID da própria thread;
   - `userId`: o identificador do autor da mensagem;
   - `agentRole`: invariavelmente `'CEO'` para triagem e orquestração inicial.

## Streaming de Atividades e Formatação

Durante a execução do turno, atividades do agente são capturadas via callback `onActivity`
e formatadas pelo `DiscordActivityFormatter`:

- **Pensamentos (`thought`)**: formatados como bloco de citação do Discord com emoji:
  `> 💭 *<texto>*`.
- **Ferramentas (`tool`)**:
  - Em andamento: `⏳ **Executando**: \`<title>\``;
  - Sucesso: `✅ **Concluído**: \`<title>\``;
  - Falha: `❌ **Falhou**: \`<title>\``.
- **Mensagem de progresso**: As atividades são agrupadas em uma mensagem de progresso dedicada
  na thread. Para evitar poluição visual, apenas as últimas 8 atividades são exibidas
  na mensagem de progresso atualizada dinamicamente.

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
- Nenhuma parte individual gerada pode ultrapassar o limite de `maxLength`.

## Interações e Comandos de Barra

Comandos de barra são interceptados por `DiscordInteractionHandler`:

- **/cancel**: Localiza o canal e a thread da interação e aciona `OrchestratorService.cancelTurn(channelId, threadId)`.
- Respostas a interações de comando utilizam flags efêmeras (`ephemeral: true`) para não
  poluir a timeline pública dos canais.
