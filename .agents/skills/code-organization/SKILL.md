---
name: code-organization
description: >
  Define a organização interna de arquivos e módulos em TypeScript e NestJS:
  superfície pública mínima, proibição total de barrel exports (index.ts), export
  restrito a consumo externo real e alocação de helpers como métodos privados em
  classes de Use Cases, Adapters e Services. Estabelece convenções de legibilidade e
  imutabilidade com const. Use ao criar, editar ou refatorar classes, métodos e funções.
---

# Organização interna de módulos e código

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar **qualquer regra descrita aqui**. O critério não
> é *qual* regra — é a natureza da mudança: uma regra de superfície pública, alocação de
> helpers ou legibilidade do projeto mudou → atualize; refator técnico que preserva o padrão
> descrito → não toque.

Esta diretriz aplica-se ao código TypeScript e aos módulos NestJS do repositório. Governa
o conteúdo interno dos arquivos, o que é exposto e como as classes e funções são organizadas.

## Superfície pública mínima

### Proibição de barrel exports (`index.ts`)

O uso de arquivos `index.ts` para reexportar múltiplos símbolos de uma pasta ou módulo é
**proibido em todo o repositório**.

No ecossistema NestJS com injeção de dependência e decoradores de metadados, arquivos de
barril introduzem dependências circulares ocultas, dificultam o tree-shaking e acoplam
indevidamente consumidores a detalhes internos.

Correto — importação direta e pontual do arquivo de origem:

```typescript
import { ConnectAgentUseCase } from './use-cases/connect-agent.use-case.ts';
import { IAgentClientPort } from './ports/agent-client.port.ts';
```

Evite — reexportação em barril:

```typescript
// index.ts dentro de use-cases/ ou modules/agent/
export * from './connect-agent.use-case.ts';
export * from './disconnect-agent.use-case.ts';
```

### `export` apenas sob consumo externo real

Não adicione `export` por conveniência ou antecipação. Exporte apenas o que é consumido fora
do arquivo:

1. Mantenha tipos, interfaces internas, constantes e funções auxiliares locais sem `export` se
   apenas o próprio arquivo os utiliza.
2. Se após uma refatoração um símbolo deixou de ser importado por outros arquivos, remova a
   palavra-chave `export`.
3. Não exporte constantes internas ou chaves de configuração se elas pertencem estritamente à
   implementação da classe.

Correto:

```typescript
const DEFAULT_TIMEOUT_MS = 5000;

export class AgentTimeoutException extends Error {
  constructor(message = `Operation timed out after ${DEFAULT_TIMEOUT_MS}ms`) {
    super(message);
  }
}
```

Evite:

```typescript
export const DEFAULT_TIMEOUT_MS = 5000; // export sem consumidor externo

export class AgentTimeoutException extends Error { ... }
```

## Onde o helper mora

### Helper de consumidor único não vira arquivo separado

Uma função auxiliar usada exclusivamente por uma única classe ou componente não deve ser
extraída para um arquivo separado com sua própria suíte de testes. Mantenha-a no mesmo arquivo
do consumidor.

Extraia para arquivo próprio apenas quando:

1. Houver **múltiplos consumidores reais** em locais distintos; ou
2. A complexidade algorítmica for tão expressiva que justifique uma suíte de testes unitários
   isolada do consumidor.

### Em classes, o helper é método privado

Quando o arquivo contém uma classe dona do comportamento (um Use Case, Adapter, Service ou
Handler), qualquer função auxiliar de apoio é declarada como **método `private` da classe**,
e não como função livre solta no corpo do arquivo:

Correto — responsabilidade contida na classe:

```typescript
@Injectable()
export class AcpAgentAdapter implements IAgentClientPort {
  async connect(targetUri: string): Promise<void> {
    const sanitizedUri = this.sanitizeUri(targetUri);
    // ...
  }

  private sanitizeUri(uri: string): string {
    return uri.trim().replace(/\/+$/, '');
  }
}
```

Evite — função solta no arquivo da classe:

```typescript
function sanitizeUri(uri: string): string {
  return uri.trim().replace(/\/+$/, '');
}

@Injectable()
export class AcpAgentAdapter implements IAgentClientPort {
  async connect(targetUri: string): Promise<void> {
    const sanitizedUri = sanitizeUri(targetUri);
    // ...
  }
}
```

Mesmo que a função seja pura, encapsulá-la como método privado responde objetivamente a quem
ela pertence, evita que outros desenvolvedores a importem inadvertidamente e preserva o foco
da classe. O teste unitário da classe exercita o helper através da sua API pública.

Ficam na raiz do arquivo apenas definições de `type`, `interface`, enums locais ou constantes
de configuração imutáveis.

## Legibilidade e clareza de fluxo

### `const` por padrão

Utilize `const` para todas as declarações de variáveis. Utilize `let` unicamente nos raros casos
em que a reatribuição de valor for estritamente necessária.

### Early return e guard clauses

Evite blocos `if/else` profundamente aninhados. Utilize cláusulas de guarda (*guard clauses*)
com retorno ou lançamento de exceção antecipado logo no início dos métodos:

Correto:

```typescript
async execute(input: ConnectAgentInput): Promise<ConnectAgentOutput> {
  if (!input.agentId) {
    throw new InvalidAgentIdException('Agent ID is required');
  }

  if (this.sessionManager.isActive(input.agentId)) {
    return this.sessionManager.get(input.agentId);
  }

  return this.createNewSession(input);
}
```

Evite:

```typescript
async execute(input: ConnectAgentInput): Promise<ConnectAgentOutput> {
  if (input.agentId) {
    if (!this.sessionManager.isActive(input.agentId)) {
      return this.createNewSession(input);
    } else {
      return this.sessionManager.get(input.agentId);
    }
  } else {
    throw new InvalidAgentIdException('Agent ID is required');
  }
}
```

## Checklist

- [ ] Nenhum arquivo `index.ts` criado ou utilizado para reexportação em lote.
- [ ] Todo `import` aponta diretamente para o arquivo que declara o símbolo.
- [ ] Apenas classes, interfaces e funções consumidas externamente possuem `export`.
- [ ] Funções auxiliares de apoio a classes são declaradas como métodos `private`.
- [ ] Variáveis declaradas exclusivamente com `const`, exceto com reatribuição deliberada.
- [ ] Métodos estruturados com guard clauses e early returns no lugar de aninhamento de `if/else`.
