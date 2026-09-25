---
name: code-comments
description: >
  Define quando um comentário é permitido e quando é ruído em código TypeScript e
  NestJS. Elimina comentários óbvios que repetem o código, cabeçalhos de seção, imports
  explicados e narração de edições passadas. Estabelece o teste das três perguntas e o
  passe de poda obrigatório antes de fechar a tarefa. Use ao criar, editar ou revisar
  arquivos .ts, .json ou YAML.
---

# Comentários em código-fonte

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar **qualquer regra descrita aqui**. O critério não
> é *qual* regra — é a natureza da mudança: a política de comentários do projeto mudou →
> atualize; refator técnico que preserva a política descrita → não toque.

Esta regra aplica-se a todo o repositório, em qualquer arquivo de código-fonte TypeScript
(`*.ts`), configurações (`*.json`, `*.yaml`) e scripts.

## O comentário é exceção, não hábito

Comentários devem ser evitados, a não ser que sejam estritamente necessários para explicar
decisão não intuitiva, restrição técnica externa, tradeoff ou contexto inacessível apenas pela
leitura do código. O código deve ser autoexplicativo através de nomes expressivos, tipos estritos
e abstrações coesas.

Correto — explica contexto externo e restrição que o código não expressa sozinho:

```typescript
/*
 * O SDK do ACP exige envio do cwd normalizado em formato POSIX para evitar falha
 * na resolução de caminhos em plataformas Windows e ambientes conteinerizados.
 */
const normalizedCwd = cwd.replace(/\\/g, '/');
```

Evite — apenas repete a mecânica visível do código:

```typescript
// substitui barras invertidas por barras normais
const normalizedCwd = cwd.replace(/\\/g, '/');
```

O nome do símbolo, a assinatura do método e os tipos do TypeScript são o canal primário de
explicação. Antes de recorrer a um comentário, elimine a ambiguidade: renomeie a variável,
extraia constantes para números ou strings mágicas, reforce os tipos ou extraia métodos
privados na classe.

## Teste das três perguntas

Submeta cada comentário pretendido às três perguntas abaixo antes de escrevê-lo. Se responder
"não" a qualquer uma, **o comentário não entra**:

1. **Ele diz algo que o código não diz?** Se a informação pode ser deduzida lendo os tipos, o
   nome do método ou as instruções seguintes, é ruído.
2. **Um leitor competente tentaria a alternativa que ele descarta?** Comentários que explicam
   "por que não fizemos X" só fazem sentido se X for uma abordagem atraente e comum que falha
   por uma razão não evidente.
3. **Ele continuará verdadeiro após a próxima refatoração?** Comentários que descrevem a ordem
   dos passos, nomes de variáveis ou fluxos internos viram mentiras assim que o código é
   refatorado. Apenas decisões duráveis sobrevivem.

## Catálogo de comentários proibidos

Os casos a seguir exemplificam violações que devem ser ativamente eliminadas:

**Repetir a assinatura, classe ou nome do método:**

```typescript
// busca o agente pelo id
async findAgentById(id: string): Promise<AgentEntity> {
```

**Comentar imports ou injeções de dependência no NestJS:**

```typescript
// importa o caso de uso de conexão
import { ConnectAgentUseCase } from './connect-agent.use-case.ts';

// injeta a porta do Discord
@Inject(IDiscordPort)
private readonly discordPort: IDiscordPort,
```

**Cabeçalhos de seção, divisores ou separadores visuais:**

```typescript
// ==========================================
// Handlers de Eventos
// ==========================================
// Métodos Privados
```

**Nomear o passo trivial dentro de um método:**

```typescript
// valida se o payload existe
if (!payload) throw new BadRequestException();

// chama o caso de uso
await this.useCase.execute(payload);
```

**JSDoc que apenas duplica informações de tipagem do TypeScript:**

```typescript
/**
 * @param sessionId - O ID da sessão
 * @returns Retorna a sessão encontrada
 */
```

**Comentários de TODO ou FIXME vagos e sem contexto:**
Marcadores como `// TODO: ajustar depois` ou `// FIXME: erro aqui` sem descrição do critério
de conclusão nem link para issue são proibidos. Débitos e pendências pertencem ao backlog ou
à descrição de tarefas, não ao código-fonte.

## O comentário descreve o código de hoje

O leitor do código consulta o arquivo no presente, sem interesse no histórico de revisões que
deram origem àquela linha.

- **Não comente a edição**: Explicações sobre abordagens anteriores descartadas, bugs antigos
  corrigidos ou justificativas de migração pertencem à mensagem de commit e ao Pull Request.
- **Escreva a partir do resultado final**: Descreva a restrição como uma característica do
  código atual, e não como uma transição ("passou a ser", "deixou de usar").

## Passe de poda antes de fechar a tarefa

Antes de finalizar qualquer tarefa que inclua ou altere código:

1. Inspecione no diff (`git diff`) todas as linhas de comentário adicionadas.
2. Aplique o teste das três perguntas a cada uma delas.
3. Apague sem hesitar qualquer comentário redundante, explicativo de sintaxe ou narração de
   edição recente.
