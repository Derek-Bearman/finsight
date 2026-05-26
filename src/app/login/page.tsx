'use client';

/**
 * Magic-link login page.
 *
 * Single-field form: user enters their email → Supabase emails them a
 * magic link → they click it → /auth/callback exchanges the code for a
 * session → proxy.ts sees the cookie and lets them through to /.
 *
 * No passwords in v1 — magic-link is the smoothest B2B accountant UX and
 * removes a whole class of credential-handling risk. We can layer
 * password or SSO later if customers ask.
 */

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

type Status = 'idle' | 'sending' | 'sent' | 'error';

function LoginForm() {
  const params = useSearchParams();
  const nextPath = params.get('next') || '/';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Show a helpful message if the user just got bounced from /auth/callback
  // due to an expired/invalid link.
  const authError = params.get('error_description');
  useEffect(() => {
    if (authError) {
      setStatus('error');
      setErrorMsg(authError);
    }
  }, [authError]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || status === 'sending') return;
    setStatus('sending');
    setErrorMsg(null);

    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Magic-link only — no password — but allow new-account creation
        // since v1 has no separate signup flow.
        shouldCreateUser: true,
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }
    setStatus('sent');
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'hsl(var(--background))' }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="mb-5">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>
              FinSight
            </h1>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
            >
              Beta
            </span>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Sign in with your email — we&apos;ll send you a one-time link.
          </p>
        </div>

        {status === 'sent' ? (
          <div className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>
            <p className="font-medium">Check your email.</p>
            <p className="mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
              We sent a sign-in link to <strong>{email}</strong>. Click it from any
              device to finish signing in.
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus('idle');
                setEmail('');
              }}
              className="mt-4 text-xs underline underline-offset-2"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label
              htmlFor="email"
              className="text-xs font-medium"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@firm.com"
              disabled={status === 'sending'}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                borderColor: 'hsl(var(--border))',
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
              }}
            />
            {errorMsg && (
              <p className="text-xs" style={{ color: 'hsl(var(--destructive))' }}>
                {errorMsg}
              </p>
            )}
            <Button type="submit" disabled={!email || status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-[11px] leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
          FinSight is for accounting firms and bookkeepers. By signing in you agree
          your client data will be stored in our secure database, scoped to your
          firm, and never used to train AI models or sold to third parties.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
