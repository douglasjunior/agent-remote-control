import { Injectable } from '@nestjs/common';

import type { AgentActivity, AgentUsage } from '../../agent/ports/agent.port.js';
import type { AgentConfigSelection, SelectedValue } from '../../orchestrator/models/agent-config-selection.model.js';
import type { AgentQuotaReport } from '../../orchestrator/models/agent-quota-report.model.js';
import type { AgentProfileSettings, AgentSettings } from '../../orchestrator/models/agent-settings.model.js';
import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnAgentInfo } from '../../orchestrator/models/turn-agent-info.model.js';
import type { QuestionAsker, QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { resolveProfile } from '../../orchestrator/utils/agent-profile.util.js';


const FENCE_PATTERN = /^```\w*/;
// Discord only renders masked links for web URLs; any other target (file://, absolute or relative paths) shows up raw.
const LOCAL_LINK_PATTERN = /!?\[([^\]\n]+)\]\(<?(?!https?:\/\/|mailto:)[^\s)>]+>?(?:\s+"[^"\n]*")?\)/g;
const CLOSE_FENCE = '\n```';
const DEFAULT_LABEL = 'default';
const MAX_TOOL_DETAILS_LENGTH = 1800;

@Injectable()
export class DiscordActivityFormatter {
  formatActivity(activity: AgentActivity): string | null {
    if (activity.kind === 'thought') {
      const text = activity.text.trim();
      if (!text) {
        return null;
      }
      const lines = this.stripLocalLinks(text).split('\n');
      return lines
        .map((line, index) => (index === 0 ? `> 💭 *${line}*` : `> *${line}*`))
        .join('\n');
    }

    if (activity.kind === 'tool') {
      switch (activity.status) {
        case 'in_progress':
          return `⏳ **Running**: \`${activity.title}\``;
        case 'completed': {
          const header = `✅ **Completed**: \`${activity.title}\``;
          const details = this.formatToolDetails(activity.details);
          return details ? `${header}\n${details}` : header;
        }
        case 'failed': {
          const header = `❌ **Failed**: \`${activity.title}\``;
          const details = this.formatToolDetails(activity.details);
          return details ? `${header}\n${details}` : header;
        }
        default:
          return null;
      }
    }

    return null;
  }

  private formatToolDetails(details?: string): string | null {
    if (!details) {
      return null;
    }
    const trimmed = details.trim();
    if (!trimmed) {
      return null;
    }
    const lines = trimmed.split('\n');
    const hasMoreLines = lines.length > 5;
    const selectedLines = hasMoreLines ? lines.slice(0, 5) : lines;
    const lineSuffix = hasMoreLines ? `\n... (+${lines.length - 5} lines)` : '';
    const availableLength = MAX_TOOL_DETAILS_LENGTH - lineSuffix.length;
    let content = selectedLines.join('\n');
    if (content.length > availableLength) {
      content = `${content.slice(0, availableLength - 3).trimEnd()}...`;
    }
    return `\`\`\`\n${content}${lineSuffix}\n\`\`\``;
  }

  formatDelegation(event: DelegationEvent): string {
    if (event.phase === 'finished') {
      return `↩️ **${event.roleName} finished**${this.formatProject(event)} — the CEO is reviewing the result.`;
    }
    return `🔀 **Task delegated** to agent **${event.roleName}** (\`${event.role}\`)${this.formatProject(event)} — it is working on it now.`;
  }

  formatDelegateResult(event: DelegationEvent & { phase: 'finished' }): string {
    return `📋 **Response from agent ${event.roleName}** (\`${event.role}\`)${this.formatProject(event)}:\n${event.response.trim()}`;
  }

  formatDelegateFooter(event: DelegationEvent & { phase: 'finished' }): string {
    return `${this.formatAgentFooter(event.agentInfo, event.usage)} · ⏱️ ${(event.durationMs / 1000).toFixed(1)}s`;
  }

  formatAgentFooter(info: TurnAgentInfo, usage?: AgentUsage): string {
    const footer = `-# 🤖 ${info.roleName} (${info.agentName}) · 🧠 ${info.modelName ?? DEFAULT_LABEL} · ⚡ ${info.effortName ?? DEFAULT_LABEL}`;
    return usage ? `${footer} · 🪙 ${this.formatTokenCount(usage.totalTokens)} tokens` : footer;
  }

  formatQuestion(prompt: QuestionPrompt): string {
    const { question, asker } = prompt;
    const lines = [
      `❓ **Question ${prompt.number}/${prompt.total}** · ${asker.roleName}${this.formatAskerProject(asker)}`,
      `**${question.text}**`,
    ];
    if (question.rationale) {
      lines.push(`_${question.rationale}_`);
    }
    lines.push(...question.options.map((option, index) => `**${index + 1}.** ${option}`));
    lines.push(question.options.length > 0
      ? '-# Reply with the option number or type another answer. /cancel stops everything.'
      : '-# Type your answer. /cancel stops everything.');
    if (prompt.waitingAskers > 0) {
      lines.push(`-# ⏳ ${prompt.waitingAskers} more agent(s) waiting for answers after this one.`);
    }
    const formatted = lines.join('\n');
    return prompt.message ? `${prompt.message}\n\n${formatted}` : formatted;
  }

  formatInvalidAnswer(prompt: QuestionPrompt): string {
    return `⚠️ Invalid option. Reply with a number from 1 to ${prompt.question.options.length} or type another answer.\n\n${this.formatQuestion({ ...prompt, message: undefined })}`;
  }

  formatAnswersSent(asker: QuestionAsker): string {
    return `✅ Answers sent to **${asker.roleName}**${this.formatAskerProject(asker)}.`;
  }

  formatSelection(selection: AgentConfigSelection): string {
    const header = this.formatSelectionHeader(selection);
    const options = selection.options.map(option =>
      option.description
        ? `**${option.index}.** ${option.label} — ${option.description}`
        : `**${option.index}.** ${option.label}`);
    return [header, ...options].join('\n');
  }

  formatInvalidSelection(selection: AgentConfigSelection): string {
    return `⚠️ Invalid option. Reply only with a number from 1 to ${selection.options.length}.\n\n${this.formatSelection(selection)}`;
  }

  formatLanguageRequest(currentLanguage: string): string {
    return `🌐 **Current language**: ${currentLanguage}\nReply with the language the agents should use to talk to you, such as "Spanish" or "Português".`;
  }

  formatLanguageSet(language: string): string {
    return `✅ **Language saved**: ${language}`;
  }

  formatInvalidLanguage(): string {
    return '⚠️ Invalid language. Reply with just the language name, up to 64 characters, such as "Spanish".';
  }

  formatQuota(report: AgentQuotaReport): string {
    if (!report.quota) {
      return `ℹ️ The ${report.agent.name} agent does not expose usage information.`;
    }
    const lines = [`📊 **${report.agent.name} usage**`];
    for (const group of report.quota.groups) {
      lines.push('', `**${group.name}**`);
      for (const bucket of group.buckets) {
        const percent = Math.round(bucket.remainingFraction * 100);
        const reset = this.formatReset(bucket.resetTime);
        lines.push(`• ${bucket.name}: ${percent}%${reset}`);
      }
    }
    return lines.join('\n');
  }

  private formatReset(resetTime: string | undefined): string {
    const timestamp = resetTime ? Date.parse(resetTime) : Number.NaN;
    return Number.isNaN(timestamp) ? '' : ` · resets <t:${Math.floor(timestamp / 1000)}:R>`;
  }

  formatConfigured(settings: AgentSettings): string {
    const profile = resolveProfile(settings, 'CEO');
    return `✅ **Settings saved**: 🤖 ${profile?.agentName} · 🧠 ${profile?.modelName ?? DEFAULT_LABEL} · ⚡ ${profile?.effortName ?? DEFAULT_LABEL}`;
  }

  formatProfilesUpdated(
    updatedRoles: readonly SelectedValue[],
    profile: AgentProfileSettings,
  ): string {
    const roles = updatedRoles.map(role => role.name).join(', ');
    return `✅ **Profiles updated** (${roles}): 🤖 ${profile.agentName} · 🧠 ${profile.modelName ?? DEFAULT_LABEL} · ⚡ ${profile.effortName ?? DEFAULT_LABEL}`;
  }

  formatProfilesClosed(): string {
    return '✅ **Profile configuration closed.**';
  }

  private formatSelectionHeader(selection: AgentConfigSelection): string {
    if (selection.step === 'profile') {
      return '👥 **Choose the profiles to configure** — type numbers separated by commas, or 0 to exit:';
    }
    const header = this.formatInnerSelectionHeader(selection);
    return selection.targetRoles ? `${header}\nType 0 to go back to the profile list.` : header;
  }

  private formatInnerSelectionHeader(selection: AgentConfigSelection): string {
    if (selection.step === 'agent') {
      return '🤖 **Choose the agent** by replying with the option number:';
    }
    if (selection.step === 'model') {
      return selection.selectedAgent
        ? `🧠 **Choose the ${selection.selectedAgent.name} model** by replying with the option number:`
        : '🧠 **Choose the agent model** by replying with the option number:';
    }
    return `⚡ **Choose the effort for ${selection.selectedModel?.name}** by replying with the option number:`;
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

  stripLocalLinks(content: string): string {
    let insideFence = false;
    return content
      .split('\n')
      .map((line) => {
        if (FENCE_PATTERN.test(line)) {
          insideFence = !insideFence;
          return line;
        }
        return insideFence ? line : line.replace(LOCAL_LINK_PATTERN, '$1');
      })
      .join('\n');
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

  private formatAskerProject(asker: QuestionAsker): string {
    return asker.projectName ? ` (\`${asker.projectName}\`)` : '';
  }

  private formatProject(event: DelegationEvent): string {
    return event.projectName ? ` in project \`${event.projectName}\`` : '';
  }
}
