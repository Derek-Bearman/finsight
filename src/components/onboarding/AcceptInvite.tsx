'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { acceptInvite } from '@/lib/data/team';

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptInvite(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.assign('/');
    });
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>You’ve been invited to a firm</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Accept to join and start working on the firm’s clients.
        </p>
        <Button onClick={handleAccept} disabled={pending} className="w-full">
          {pending ? 'Joining…' : 'Accept invitation'}
        </Button>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
