---
name: tests-best-practices
description: >
  Regras para testes automatizados com Vitest e NestJS Testing Module. Abrange a
  regra de ouro de vi.mock apenas para fronteiras externas de I/O, criação de stubs e
  fakes implementando ports com factory functions, substituição de providers por Symbol,
  asserções de efeito observável, determinismo com fake timers e meta de 100% de
  cobertura. Use ao criar, modificar ou revisar arquivos *.spec.ts.
---

# Boas práticas de testes automatizados

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar **qualquer regra descrita aqui**. O critério não
> é *qual* regra — é a natureza da mudança: uma diretriz ou convenção de testes mudou →
> atualize; refator técnico que preserva a prática descrita → não toque.

Esta diretriz governa todos os testes automatizados da aplicação, executados via Vitest
e integrados ao módulo de testes do NestJS (`@nestjs/testing`).

## Stack e comandos

- **Framework**: Vitest com `globals: true`.
- **Ambiente**: Node.js puro (`environment: 'node'`).
- **Localização dos arquivos**: `*.spec.ts` colocados **lado a lado** com o arquivo de
  produção correspondente em `src/`.
- **Testes e2e**: localizados no diretório `test/` e executados com `vitest.config.e2e.ts`.
- **Comandos**:
  - `yarn test`: Executa todos os testes unitários uma vez;
  - `yarn test:cov`: Executa os testes e gera relatório de cobertura de código;
  - `yarn test:e2e`: Executa os testes ponta a ponta.

## Regra de ouro: `vi.mock` exclusivo para fronteiras externas

**Dependências internas do projeto (qualquer arquivo localizado em `src/`) jamais devem ser
mockadas utilizando `vi.mock`.**

- **Permitido com `vi.mock`**:
  - Módulos nativos da plataforma Node: `node:fs`, `node:child_process`, `node:crypto`, etc.
  - SDKs de terceiros e clientes de rede externos que realizam I/O real (ex.: `@modelcontextprotocol/sdk`,
    cliente do Discord.js ou bibliotecas de protocolo externo).
- **Proibido com `vi.mock`**:
  - Qualquer porta (`*.port.ts`), adaptador (`*.adapter.ts`), caso de uso (`*.use-case.ts`),
    serviço (`*.service.ts`) ou controller/handler do projeto.

### Por que stubs e fakes em vez de `vi.mock`?

Mockar módulos internos acopla os testes à estrutura de imports do arquivo e esconde quebras
de contrato: se a assinatura de um método em uma porta mudar, o mock continuará passando
silenciosamente enquanto o código real quebra em produção.

Ao utilizar **stubs tipados que implementam a interface da porta (`implements IMyPort`)**,
qualquer alteração contratual quebra a compilação do TypeScript imediatamente, oferecendo
feedback confiável e instantâneo.

## Padrão de stubs e injeção com NestJS

### Implementando a interface da porta (`implements`)

Crie classes stub que implementem todos os métodos definidos na interface da porta. Disponibilize
campos públicos para configurar retornos simulados e registrar invocações:

```typescript
import { IAgentClientPort, AgentSessionData } from '../ports/agent-client.port.ts';

export class StubAgentClientPort implements IAgentClientPort {
  connected = false;
  sessions: AgentSessionData[] = [];
  throwOnConnect = false;

  async connect(): Promise<void> {
    if (this.throwOnConnect) {
      throw new Error('Connection refused');
    }
    this.connected = true;
  }

  async createSession(cwd: string): Promise<string> {
    const session: AgentSessionData = { sessionId: 'mock-session-id', cwd };
    this.sessions.push(session);
    return session.sessionId;
  }
}
```

### Fábrica de stubs com overrides (`createStub*`)

Para simplificar a escrita de testes sem duplicar código, padronize fábricas que entregam um
stub padrão com comportamento neutro (no-op) e permitem sobrescrever apenas os métodos
relevantes para o teste específico:

```typescript
export function createStubAgentClient(
  overrides?: Partial<IAgentClientPort>,
): IAgentClientPort {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue('default-session-id'),
    closeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

### Injeção de dependência no `Test.createTestingModule`

Ao utilizar o utilitário de testes do NestJS, substitua a implementação concreta associando o
`Symbol` da porta ao stub correspondente:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectAgentUseCase } from './connect-agent.use-case.ts';
import { IAgentClientPort } from '../ports/agent-client.port.ts';
import { StubAgentClientPort } from '../testing/agent-client.stub.ts';

describe('ConnectAgentUseCase', () => {
  let useCase: ConnectAgentUseCase;
  let stubAgentClient: StubAgentClientPort;

  beforeEach(async () => {
    stubAgentClient = new StubAgentClientPort();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectAgentUseCase,
        {
          provide: IAgentClientPort,
          useValue: stubAgentClient,
        },
      ],
    }).compile();

    useCase = module.get<ConnectAgentUseCase>(ConnectAgentUseCase);
  });

  it('should connect to agent client and return active status', async () => {
    const result = await useCase.execute({ targetUri: 'localhost:8080' });

    expect(result.isConnected).toBe(true);
    expect(stubAgentClient.connected).toBe(true);
  });
});
```

Para testes unitários puros sem necessidade do container NestJS, instancie diretamente a
classe do Caso de Uso passando o stub no construtor:

```typescript
const stubAgentClient = new StubAgentClientPort();
const sut = new ConnectAgentUseCase(stubAgentClient);
```

## Asserções: Efeito observável sobre espionagem de implementação

Prefira validar o **resultado observável** e as mudanças de estado provocadas pelo sistema sob
teste em vez de apenas verificar chamadas internas de métodos:

Correto — valida o efeito final da operação:

```typescript
const output = await useCase.execute(input);

expect(output.sessionId).toBe('session-123');
expect(stubPort.sessions).toContainEqual(expect.objectContaining({ sessionId: 'session-123' }));
```

Evite — validação acoplada ao detalhe de invocação interna:

```typescript
expect(stubPort.createSession).toHaveBeenCalledWith('/workspace/repo');
```

Utilize spies (`toHaveBeenCalledWith`) somente quando a interação em si com a fronteira
externa representar o contrato funcional primário (ex.: validar que uma notificação crítica
foi despachada ao canal do Discord com os parâmetros corretos).

### Uso de matchers específicos

Prefira matchers explícitos do Vitest para produzir diagnósticos claros em caso de falha:

- `toHaveLength(n)` no lugar de `expect(array.length).toBe(n)`;
- `toBeNull()` e `toBeUndefined()` no lugar de `toBe(null)` / `toBe(undefined)`;
- `toContainEqual(...)` para coleções de objetos;
- `toThrowError(...)` ou `rejects.toThrow(...)` para validação de erros.

## Determinismo e manipulação de tempo

Testes automatizados devem ser determinísticos e independentes de latência de clock do sistema:

- **Proibido `setTimeout` arbitrário**: Nunca use atrasos fixos para esperar execuções assíncronas.
  Utilize `vi.waitFor(() => expect(...))` do Vitest para aguardar eventos ou condições esperadas.
- **Fake timers para operações temporais**: Ao testar timeouts, retentativas ou debouncing,
  utilize os timers simulados do Vitest (`vi.useFakeTimers()`) e avance o tempo deliberadamente
  com `await vi.advanceTimersByTimeAsync(ms)`.

## Metas de cobertura

A meta operacional é de **100% de cobertura das linhas executáveis** de código de produção.

Para cada caso de uso, adapter ou service, assegure testes para:
1. Caminho feliz (*happy path*);
2. Validações e rejeições esperadas (lançamento de exceções específicas);
3. Casos de borda (coleções vazias, valores limites, timeouts);
4. Todas as ramificações condicionais (`if/else`, operadores `??` e `||`).

## Convenções de estilo

- Testes escritos em inglês (`describe('NomeDaClasse')`, `it('should ...', async () => ...)`).
- Estrutura clara no padrão Arrange-Act-Assert (AAA) em cada cenário de teste.
- Prefixar stubs com `Stub*` ou `Fake*`.
- Isolar o estado: nenhum teste deve depender do resultado de outro; garanta reinicialização
  de dados em `beforeEach`.
- **Proibição de barrel exports**: Testes devem importar classes, interfaces, símbolos e stubs diretamente do arquivo de origem onde foram definidos, sem usar arquivos `index.ts`.

## Checklist

- [ ] Nenhum `vi.mock` apontando para arquivos em `src/`.
- [ ] Stubs implementam explicitamente as interfaces de portas (`implements I...Port`).
- [ ] Substituição no container NestJS feita através do `Symbol` da porta.
- [ ] Importações diretas dos arquivos de origem, sem barrel exports (`index.ts`).
- [ ] Asserções verificam estado e efeitos observáveis antes de checar chamadas a métodos.
- [ ] Nenhum delay de tempo real (`setTimeout`); uso exclusivo de `vi.waitFor` ou fake timers.
- [ ] Todos os ramos e tratamentos de erro cobertos pelo spec.
- [ ] Validação mandatória executada com `yarn lint` e `yarn test` (e `yarn test:e2e`).
