import { Injectable } from '@nestjs/common';

import type { AgentActivity, AgentUsage } from '../../agent/ports/agent.port.js';
import type { AgentConfigSelection } from '../../orchestrator/models/agent-config-selection.model.js';
import type { AgentSettings } from '../../orchestrator/models/agent-settings.model.js';
import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnAgentInfo } from '../../orchestrator/models/turn-agent-info.model.js';


const FENCE_PATTERN = /^```\w*/;
const CLOSE_FENCE = '\n```';
const DEFAULT_LABEL = 'padrão';

@Injectable()
export class DiscordActivityFormatter {
  formatActivity(activity: AgentActivity): string | null {
    if (activity.kind === 'thought') {
      const text = activity.text.trim();
      if (!text) {
        return null;
      }
      const lines = text.split('\n');
      return lines
        .map((line, index) => (index === 0 ? `> 💭 *${line}*` : `> *${line}*`))
        .join('\n');
    }

    if (activity.kind === 'tool') {
      switch (activity.status) {
        case 'in_progress':
          return `⏳ **Executando**: \`${activity.title}\``;
        case 'completed':
          return `✅ **Concluído**: \`${activity.title}\``;
        case 'failed':
          return `❌ **Falhou**: \`${activity.title}\``;
        default:
          return null;
      }
    }

    return null;
  }

  formatDelegation(event: DelegationEvent): string {
    if (event.phase === 'finished') {
      return `↩️ **${event.roleName} concluiu** — o CEO está revisando o resultado.`;
    }
    const project = event.projectName ? ` no projeto \`${event.projectName}\`` : '';
    return `🔀 **Tarefa delegada** — agora é o agente **${event.roleName}** que está trabalhando${project}.`;
  }

  formatDelegateProgressHeader(roleName: string): string {
    return `🤖 **Progresso — ${roleName}**:\n`;
  }

  formatAgentFooter(info: TurnAgentInfo, usage?: AgentUsage): string {
    const footer = `-# 🤖 ${info.roleName} (${info.agentName}) · 🧠 ${info.modelName ?? DEFAULT_LABEL} · ⚡ ${info.effortName ?? DEFAULT_LABEL}`;
    return usage ? `${footer} · 🪙 ${this.formatTokenCount(usage.totalTokens)} tokens` : footer;
  }

  formatSelection(selection: AgentConfigSelection): string {
    const header = selection.step === 'model'
      ? '🧠 **Escolha o modelo do agente** respondendo com o número da opção:'
      : `⚡ **Escolha o effort para ${selection.selectedModel?.name}** respondendo com o número da opção:`;
    const options = selection.options.map(option =>
      option.description
        ? `**${option.index}.** ${option.label} — ${option.description}`
        : `**${option.index}.** ${option.label}`);
    return [header, ...options].join('\n');
  }

  formatInvalidSelection(selection: AgentConfigSelection): string {
    return `⚠️ Opção inválida. Responda apenas com um número de 1 a ${selection.options.length}.\n\n${this.formatSelection(selection)}`;
  }

  formatConfigured(settings: AgentSettings): string {
    return `✅ **Configuração salva**: 🧠 ${settings.modelName} · ⚡ ${settings.effortName ?? DEFAULT_LABEL}`;
  }

  private formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}k`;
    }
    return String(tokens);
  }

  splitMessage(content: string, maxLength = 2000): string[] {
    if (!content) {
      return [];
    }

    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let lines: string[] = [];
    let length = 0;
    let openFence: string | null = null;

    const append = (line: string): void => {
      length += (lines.length > 0 ? 1 : 0) + line.length;
      lines.push(line);
    };
    const room = (reserve: number): number =>
      maxLength - length - (lines.length > 0 ? 1 : 0) - reserve;
    const flush = (): void => {
      chunks.push(lines.join('\n') + (openFence ? CLOSE_FENCE : ''));
      lines = [];
      length = 0;
      if (openFence) {
        append(openFence);
      }
    };

    for (const line of content.split('\n')) {
      const fence = line.match(FENCE_PATTERN)?.[0];
      const nextFence: string | null = fence ? (openFence ? null : fence) : openFence;
      const reserve = nextFence ? CLOSE_FENCE.length : 0;

      if (line.length > room(reserve) && lines.length > 0) {
        flush();
      }

      let rest = line;
      while (rest.length > room(reserve)) {
        const capacity = Math.max(1, room(openFence ? CLOSE_FENCE.length : 0));
        append(rest.slice(0, capacity));
        rest = rest.slice(capacity);
        flush();
      }
      append(rest);
      openFence = nextFence;
    }

    chunks.push(lines.join('\n') + (openFence ? CLOSE_FENCE : ''));
    return chunks;
  }
}
