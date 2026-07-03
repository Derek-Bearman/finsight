'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { openBillingPortal } from '@/lib/billing/actions';

export function ManageBillingButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle() {
    setError(null);
    startTransition(async () => {
      const res = await openBillingPortal(window.location.origin);
      if (!res.ok) return setError(res.error);
      window.location.assign(res.data.url);
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handle} disabled={pending}>
        {pending ? 'Opening…' : 'Manage billing'}
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
