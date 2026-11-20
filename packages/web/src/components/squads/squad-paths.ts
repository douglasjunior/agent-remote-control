import type { Location } from 'react-router';

import type { ProfileDraft } from '../settings/profile-choice.js';


const SQUADS_PATH = '/squads';
export const NEW_SQUAD_PATH = `${SQUADS_PATH}/new`;

/**
 * Where closing the squads page returns, carried in the router state, and the profiles a new squad starts from when
 * it is saved from a conversation.
 */
export type SquadsState = {
  readonly returnTo?: string;
  readonly draft?: { readonly profiles: Readonly<Record<string, ProfileDraft>> };
};

export function squadsPath(id?: string): string {
  return id ? `${SQUADS_PATH}/${encodeURIComponent(id)}` : SQUADS_PATH;
}

/** The state of a link into the squads page: a link from another page remembers it, one within the page keeps where to return. */
export function squadsState(location: Location): SquadsState | null {
  if (!location.pathname.startsWith(SQUADS_PATH)) {
    return { returnTo: location.pathname };
  }
  const returnTo = (location.state as SquadsState | null)?.returnTo;
  return returnTo ? { returnTo } : null;
}
