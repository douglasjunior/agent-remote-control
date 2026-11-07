import { Check, Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';

import { type AgentLoginState, safeLoginUrl } from './agent-login-state.js';


export function LoginLink({ url }: { readonly url: string | undefined }) {
  const href = safeLoginUrl(url);
  if (!href) {
    return null;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
    >
      Open login page
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

export function LoginCode({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => setCopied(true));
  };

  return (
    <span className="inline-flex items-center gap-2">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm tracking-wider">{code}</code>
      <Button type="button" variant="ghost" size="xs" aria-label="Copy code" onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}

type AgentLoginCardProps = {
  readonly agentName: string;
  readonly state: AgentLoginState;
  readonly onSubmitCode: (text: string) => void;
  readonly onCancel: () => void;
};

/** What a running login asks of the user: the link, the one-time code and, for some CLIs, the code the browser shows. */
export function AgentLoginCard({ agentName, state, onSubmitCode, onCancel }: AgentLoginCardProps) {
  const [code, setCode] = useState('');
  if (state.kind === 'idle' || state.kind === 'failed') {
    return null;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = code.trim();
    if (text) {
      onSubmitCode(text);
      setCode('');
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm" aria-label={`${agentName} login`}>
      {state.kind === 'starting' && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          Starting the login…
        </p>
      )}
      {state.kind !== 'starting' && <LoginLink url={state.url} />}
      {state.kind !== 'starting' && state.code && (
        <p className="flex items-center gap-2">
          One-time code
          {' '}
          <LoginCode code={state.code} />
        </p>
      )}
      {state.kind === 'waiting' && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          Waiting for you to finish in the browser…
        </p>
      )}
      {state.kind === 'verifying' && (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          Checking the code…
        </p>
      )}
      {state.kind === 'prompt' && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          {state.rejected && (
            <p role="alert" className="text-destructive">That code was not accepted. Paste it again.</p>
          )}
          <label htmlFor={`login-code-${agentName}`} className="text-muted-foreground">
            Paste the code the browser shows
          </label>
          <div className="flex gap-2">
            <Input
              id={`login-code-${agentName}`}
              value={code}
              onChange={event => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" size="sm" disabled={code.trim() === ''}>Send</Button>
          </div>
        </form>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
