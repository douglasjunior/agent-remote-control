import type { Squad } from '@agent-remote-control/protocol/squad';


/** The choice that applies no squad: the conversation inherits the setup the server gives a new one. */
export const CUSTOM_SQUAD = 'custom';

/** The squad a choice stands for: the one picked while it exists, else the default squad, else none. */
export function resolveSquad(squads: readonly Squad[], choice: string | null): string {
  if (choice === CUSTOM_SQUAD || squads.some(squad => squad.id === choice)) {
    return choice as string;
  }
  return squads.find(squad => squad.isDefault)?.id ?? CUSTOM_SQUAD;
}
