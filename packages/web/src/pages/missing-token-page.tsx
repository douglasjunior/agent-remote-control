import { useState, type FormEvent } from 'react';

import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';
import { useConnection } from '../connection/connection-context.js';


export function MissingTokenPage() {
  const { submitToken } = useConnection();
  const [token, setToken] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitToken(token);
  };

  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Access token</CardTitle>
          <CardDescription>
            Enter the token printed in the server log (&quot;Web interface access token&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              aria-label="Access token"
              value={token}
              onChange={event => setToken(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              autoFocus
            />
            <Button type="submit" disabled={!token.trim()}>Connect</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
