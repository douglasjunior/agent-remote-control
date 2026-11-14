import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';


/** The hosted web app opened without the remote link of a host, so it knows no host to reach. */
export function RemoteLinkMissingPage() {
  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Open your server&apos;s link</CardTitle>
          <CardDescription>
            This page reaches an Agent Remote Control server from anywhere. Open the link your server printed in its
            log at startup (&quot;Remote access link&quot;).
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
