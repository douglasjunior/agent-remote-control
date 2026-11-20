import { conversationEntrySchema, type ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable } from '@nestjs/common';

import { IAgentRegistryPort } from '../../orchestrator/ports/agent-registry.port.js';


/** The only agent of the versions that wrote `thought` and `tool` entries without a role; also the asker when a name matches no role. */
const LEGACY_ROLE = 'CEO';
const STEERED_NOTICE = 'The CEO took a message into the work in progress.';
/** Longest piece of the original text a warning notice quotes. */
const EXCERPT_LENGTH = 200;
/** The fields of an entry that hold text a person wrote or read, in the order a warning notice quotes them. */
const HUMAN_TEXT_FIELDS = ['text', 'response', 'title', 'message'] as const;

type RawEntry = Record<string, unknown>;

/** What stands in for an `id` or an `at` the entry lacks. */
export interface LegacyEntryFallback {
  readonly id: string;
  readonly at: string;
}

/**
 * - `valid`: the entry already matches the current format and passes through;
 * - `upgraded`: rules turned the entry into a valid one;
 * - `warning`: nothing could, so a warning notice stands in for it.
 */
export type LegacyEntryOutcome = 'valid' | 'upgraded' | 'warning';

export interface UpgradedEntry {
  readonly entry: ConversationEntry;
  readonly outcome: LegacyEntryOutcome;
}

/**
 * Turns an entry of a conversation history written by an earlier version into a `ConversationEntry`, so an
 * entry of an older shape never costs the conversation its history. Rules, applied when the entry is not valid as read:
 *
 * - `id` missing: the fallback id; `at` missing or not a date: the fallback time;
 * - `agent_response` with `status: "steered"`, which marked that the CEO took a user message into the work in
 *   progress and has an empty response: an `info` notice with the same `id` and `at`; one that has a response is
 *   `completed`, so its text stays;
 * - `thought` and `tool` without a `role`: `CEO`, the single agent of those versions;
 * - `delegation` without a `delegationId`: `legacy-<entry id>`; without a `summary`: empty;
 * - `question` without `closed`: closed, since nobody can answer an old question; without `askerRole`: the role whose
 *   display name is `askerRoleName` (or whose identifier it is), else `CEO`;
 * - an entry still invalid after that (unknown type, broken data) becomes a `warning` notice with its `id` and `at`
 *   that names the original type and quotes up to {@link EXCERPT_LENGTH} characters of its text.
 */
@Injectable()
export class LegacyConversationEntryUpgraderService {
  constructor(@Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort) {}

  upgrade(raw: unknown, fallback: LegacyEntryFallback): UpgradedEntry {
    const valid = conversationEntrySchema.safeParse(raw);
    if (valid.success) {
      return { entry: valid.data, outcome: 'valid' };
    }
    const entry = this.isRecord(raw) ? this.restore(raw, fallback) : undefined;
    const upgraded = conversationEntrySchema.safeParse(entry);
    if (upgraded.success) {
      return { entry: upgraded.data, outcome: 'upgraded' };
    }
    return { entry: this.warning(raw, fallback), outcome: 'warning' };
  }

  private restore(raw: RawEntry, fallback: LegacyEntryFallback): RawEntry {
    const entry: RawEntry = {
      ...raw,
      id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : fallback.id,
      at: this.isoTime(raw.at) ?? fallback.at,
    };
    switch (raw.type) {
      case 'agent_response':
        return raw.status === 'steered' ? this.steered(entry) : entry;
      case 'thought':
      case 'tool':
        return { ...entry, role: this.text(raw.role) ?? LEGACY_ROLE };
      case 'delegation':
        return { ...entry, delegationId: this.text(raw.delegationId) ?? `legacy-${String(entry.id)}`, summary: this.text(raw.summary) ?? '' };
      case 'question':
        return { ...entry, askerRole: this.text(raw.askerRole) ?? this.roleNamed(raw.askerRoleName), closed: typeof raw.closed === 'boolean' ? raw.closed : true };
      default:
        return entry;
    }
  }

  private steered(entry: RawEntry): RawEntry {
    if (this.text(entry.response) !== undefined) {
      return { ...entry, status: 'completed' };
    }
    return { id: entry.id, at: entry.at, type: 'notice', level: 'info', text: STEERED_NOTICE };
  }

  private warning(raw: unknown, fallback: LegacyEntryFallback): ConversationEntry {
    const record = this.isRecord(raw) ? raw : {};
    const type = this.text(record.type) ?? 'unknown';
    const excerpt = HUMAN_TEXT_FIELDS.map(field => this.text(record[field])).find(value => value !== undefined);
    return {
      id: this.text(record.id) ?? fallback.id,
      at: this.isoTime(record.at) ?? fallback.at,
      type: 'notice',
      level: 'warning',
      text: `An entry of type "${type}" could not be converted to the current format.${excerpt === undefined ? '' : ` It read: ${this.truncate(excerpt)}`}`,
    };
  }

  private roleNamed(name: unknown): string {
    const wanted = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const role = this.agentRegistry.listRoles().find(candidate =>
      candidate.toLowerCase() === wanted || this.agentRegistry.getDisplayName(candidate).toLowerCase() === wanted);
    return role ?? LEGACY_ROLE;
  }

  private truncate(text: string): string {
    return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;
  }

  /** The value when it is a non-empty string. */
  private text(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  /** A string or a number of milliseconds that names a moment, as the ISO-8601 string the protocol carries. */
  private isoTime(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return undefined;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? undefined : new Date(time).toISOString();
  }

  private isRecord(value: unknown): value is RawEntry {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
