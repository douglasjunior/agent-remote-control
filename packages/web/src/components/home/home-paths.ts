export const HOME_PATH = '/';

/** Router state of a visit to the home screen that asks for the composer to take the focus. */
export type HomeFocusState = { readonly focusComposer: number };

export function homeFocusState(): HomeFocusState {
  return { focusComposer: Date.now() };
}

/** The value that changes with each request for the focus, `null` when the visit asks for none. */
export function homeFocusRequest(state: unknown): number | null {
  const request = (state as Partial<HomeFocusState> | null)?.focusComposer;
  return typeof request === 'number' ? request : null;
}
