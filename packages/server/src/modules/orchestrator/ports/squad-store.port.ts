import type { Squad } from '../models/squad.model.js';


/** The fields of a squad to save; the store gives a new squad its id and keeps the creation time of an existing one. */
export type SquadDraft = Omit<Squad, 'id' | 'createdAt' | 'updatedAt'> & { readonly id?: string };

export type SquadSaveOutcome =
  | { readonly ok: true; readonly squad: Squad }
  | { readonly ok: false; readonly reason: 'name-taken' | 'not-found' };

export interface ISquadStorePort {
  /** Every squad, by name. */
  list(): Promise<readonly Squad[]>;
  get(id: string): Promise<Squad | null>;
  findDefault(): Promise<Squad | null>;
  /**
   * Creates the squad, or replaces the one with `id`, as one step: refuses a name another squad has in any letter case,
   * or an `id` that does not exist, and makes a default squad the only one.
   */
  save(draft: SquadDraft): Promise<SquadSaveOutcome>;
  /** Resolves to whether the squad existed. */
  delete(id: string): Promise<boolean>;
}

export const ISquadStorePort = Symbol('ISquadStorePort');
