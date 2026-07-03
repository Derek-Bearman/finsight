'use client';

/**
 * The two-door onboarding fork (both paths, per the locked decision): start a
 * new firm (card-upfront trial) OR join an existing firm via an invite link.
 */

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { beginFirmSignup } from '@/lib/data/onboarding';

export function OnboardingFork() {
  const [firmName, setFirmName] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const origin = window.location.origin;
      const res = await beginFirmSignup(firmName, origin);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.mode === 'redirect') window.location.assign(res.data.url);
      else window.location.assign('/?welcome=1');
    });
  }

  function handleJoin() {
    setError(null);
    // Accept either a full link or a bare token.
    const token = inviteLink.trim().split('/').filter(Boolean).pop() ?? '';
    if (!token) {
      setError('Paste the invite link from your email.');
      return;
    }
    window.location.assign(`/invite/${encodeURIComponent(token)}`);
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Start your firm</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            7-day free trial. Card required up front, then $97/mo. Unlimited clients and teammates.
          </p>
          <input
            type="text"
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
            placeholder="Firm name (e.g. Acme Accounting)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="Firm name"
          />
          <Button onClick={handleStart} disabled={pending} className="w-full">
            {pending ? 'Starting…' : 'Start free trial'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Join your team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Were you invited? Paste the invite link from your email. No invite yet? Ask your firm’s admin to send one.
          </p>
          <input
            type="text"
            value={inviteLink}
            onChange={(e) => setInviteLink(e.target.value)}
            placeholder="Paste invite link"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="Invite link"
          />
          <Button onClick={handleJoin} variant="outline" className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="md:col-span-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
