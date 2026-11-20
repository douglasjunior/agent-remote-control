import type { Squad } from '../models/squad.model.js';
import type { ISquadStorePort, SquadDraft, SquadSaveOutcome } from '../ports/squad-store.port.js';


/** Squads in memory, with the rules of the store: unique names in any letter case and one default at most. */
export class InMemorySquadStoreFake implements ISquadStorePort {
  readonly squads = new Map<string, Squad>();
  private nextId = 1;

  seed(squad: Squad): Squad {
    this.squads.set(squad.id, squad);
    return squad;
  }

  async list(): Promise<readonly Squad[]> {
    return [...this.squads.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(id: string): Promise<Squad | null> {
    return this.squads.get(id) ?? null;
  }

  async findDefault(): Promise<Squad | null> {
    return [...this.squads.values()].find(squad => squad.isDefault) ?? null;
  }

  async save(draft: SquadDraft): Promise<SquadSaveOutcome> {
    const existing = draft.id ? this.squads.get(draft.id) : undefined;
    if (draft.id && !existing) {
      return { ok: false, reason: 'not-found' };
    }
    const id = draft.id ?? `squad-${this.nextId++}`;
    if ([...this.squads.values()].some(squad => squad.id !== id && squad.name.toLowerCase() === draft.name.toLowerCase())) {
      return { ok: false, reason: 'name-taken' };
    }
    if (draft.isDefault) {
      for (const squad of this.squads.values()) {
        this.squads.set(squad.id, { ...squad, isDefault: false });
      }
    }
    const now = new Date().toISOString();
    const { id: _id, ...fields } = draft;
    const squad: Squad = { ...fields, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.squads.set(id, squad);
    return { ok: true, squad };
  }

  async delete(id: string): Promise<boolean> {
    return this.squads.delete(id);
  }
}
