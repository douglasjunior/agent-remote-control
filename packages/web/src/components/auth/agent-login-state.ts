export type AgentLoginState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'waiting'; readonly url: string; readonly code?: string }
  | {
    readonly kind: 'prompt';
    readonly hint: string;
    /** The login asked for the code again after one was sent. */
    readonly rejected?: boolean;
    readonly url?: string;
    readonly code?: string;
  }
  | { readonly kind: 'verifying'; readonly url?: string; readonly code?: string }
  | { readonly kind: 'failed'; readonly reason: string };

export const IDLE: AgentLoginState = { kind: 'idle' };

/** Only web links are offered to the user; anything else a CLI prints is not rendered as a link. */
export function safeLoginUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
