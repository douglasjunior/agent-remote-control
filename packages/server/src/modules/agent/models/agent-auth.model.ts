export type AgentAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';

export type AgentAuthInfo = {
  readonly agentId: string;
  readonly displayName: string;
  readonly status: AgentAuthStatus;
  /** Account the CLI reports, such as an e-mail address. */
  readonly detail?: string;
};

/**
 * Progress of a login run. `url` can repeat for the same login when the one-time code arrives after
 * the link; `prompt` means the CLI waits for text on its stdin (a code pasted from the browser).
 */
export type AgentLoginEvent =
  | { readonly kind: 'url'; readonly url: string; readonly code?: string }
  | { readonly kind: 'prompt'; readonly hint: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'cancelled' };

export type AgentLoginListener = (event: AgentLoginEvent) => void;

export type AgentLoginSubscription = {
  unsubscribe(): void;
  /** Settles once the login ended, whatever the outcome; never rejects. */
  readonly done: Promise<void>;
};
