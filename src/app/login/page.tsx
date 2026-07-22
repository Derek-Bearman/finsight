'use client';

/**
 * OTP-code login page (replaces the original magic-link flow).
 *
 * Why OTP code instead of magic link:
 *   - Outlook Safe Links and other corporate email gateways aggressively
 *     flag URLs that point to random-string subdomains on young SaaS
 *     platforms (e.g. `camphmqvrzqpgrhdjafo.supabase.co`). The link in a
 *     magic-link email gets blocked or rewritten before the user can
 *     click it.
 *   - A plain 6-digit numeric code in the email body has no URL for
 *     email security software to scan, so it sails through. Same security
 *     model (one-time, time-limited, server-verified), much better
 *     deliverability.
 *
 * Flow:
 *   1. Step "email": user enters email → signInWithOtp triggers Supabase
 *      to email a 6-digit code.
 *   2. Step "code": user reads the code from their inbox, types it in →
 *      verifyOtp({ type: 'email' }) establishes the session.
 *   3. Redirect to `next` path (or /).
 *
 * If the user clicks the magic LINK in the email instead of using the
 * code, /auth/callback still handles it as a fallback. Both paths work;
 * the UI just nudges users toward the code path.
 *
 * Email template note: Supabase's default email template includes BOTH
 * the code and a link. To make this truly code-only (no link for email
 * gateways to flag), the email template in the Supabase dashboard needs
 * to be edited to omit `{{ .ConfirmationURL }}`. Until that's done, the
 * code path still works — the link is just visible too.
 */

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { sanitizeNext } from '@/lib/safe-next';
import { Button } from '@/components/ui/button';

type Step = 'email' | 'code';
type Status = 'idle' | 'sending' | 'verifying' | 'demo';

// Public demo account. The credentials are intentionally shipped to the
// client: the account is a plain 'member' of the sandbox firm "Demo
// Advisory Group" (cannot invite teammates, cannot reach billing actions),
// RLS scopes it to that firm only, and a nightly job resets the firm's
// workspaces to the canonical sample. Password sign-in also keeps the demo
// independent of OTP email delivery.
const DEMO_EMAIL = 'demo@finsight.test';
const DEMO_PASSWORD = 'FinSightDemo!2026';

function LoginForm() {
  const params = useSearchParams();
  // Sanitized: an attacker-crafted /login?next=//evil.com must never turn
  // the post-OTP window.location.assign below into an open redirect.
  const nextPath = sanitizeNext(params.get('next'));

  const [step, setStep] = useState<Step>('email');
  const [status, setStatus] = useState<Status>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const codeInputRef = useRef<HTMLInputElement>(null);

  // Surface auth errors that came back from /auth/callback (e.g. expired
  // magic link, wrong project) by populating the error banner on /login.
  const authError = params.get('error_description');
  useEffect(() => {
    if (authError) setErrorMsg(authError);
  }, [authError]);

  // When we transition to the code step, autofocus the code input so the
  // user can paste/type immediately without clicking.
  useEffect(() => {
    if (step === 'code') codeInputRef.current?.focus();
  }, [step]);

  // ── Step 1: send the email ────────────────────────────────────────────
  async function handleSendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || status !== 'idle') return;
    setStatus('sending');
    setErrorMsg(null);

    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Allow account creation on first sign-in (no separate signup
        // flow in v1).
        shouldCreateUser: true,
        // Magic-link fallback URL — only used if the user clicks the
        // link in the email instead of entering the code.
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      setStatus('idle');
      setErrorMsg(error.message);
      return;
    }
    setStatus('idle');
    setStep('code');
  }

  // ── Step 2: verify the code ───────────────────────────────────────────
  async function handleVerifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code || status !== 'idle') return;
    setStatus('verifying');
    setErrorMsg(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    });

    if (error) {
      setStatus('idle');
      setErrorMsg(error.message);
      return;
    }

    // Full page navigation — gives the middleware a chance to see the
    // fresh session cookie before rendering the protected route.
    window.location.assign(nextPath);
  }

  function handleStartOver() {
    setStep('email');
    setStatus('idle');
    setCode('');
    setErrorMsg(null);
  }

  // ── Demo: one-click sign-in to the seeded sandbox firm ───────────────
  async function handleDemo() {
    if (status !== 'idle') return;
    setStatus('demo');
    setErrorMsg(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    });

    if (error) {
      setStatus('idle');
      setErrorMsg('The demo is unavailable right now. Sign in with your email instead.');
      return;
    }

    // Full page navigation, same as the OTP path — the middleware must see
    // the fresh session cookie before rendering the protected route.
    window.location.assign('/');
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
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
            {step === 'email'
              ? "Sign in with your email — we'll send you a one-time code."
              : `We sent a code to ${email}. Enter it below to finish signing in.`}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-3">
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
            <Button type="submit" disabled={!email || status !== 'idle'}>
              {status === 'sending' ? 'Sending…' : 'Email me a code'}
            </Button>
            <div className="my-1 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: 'hsl(var(--border))' }} />
              <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                or
              </span>
              <div className="h-px flex-1" style={{ background: 'hsl(var(--border))' }} />
            </div>
            <Button type="button" variant="outline" onClick={handleDemo} disabled={status !== 'idle'}>
              {status === 'demo' ? 'Opening the demo…' : 'Explore the live demo'}
            </Button>
            <p className="text-[11px] leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
              No email needed — opens a sample firm with a seeded restaurant client.
              Shared sandbox; it resets nightly.
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
            <label
              htmlFor="code"
              className="text-xs font-medium"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Verification code
            </label>
            <input
              ref={codeInputRef}
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              required
              // Length-agnostic: Supabase's OTP length is a server-side
              // setting (we've seen it emit 8 digits). Don't hard-code 6 —
              // accept whatever arrives, filter to digits, cap generously.
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Enter the code from your email"
              disabled={status === 'verifying'}
              className="w-full rounded-lg border px-3 py-2 text-lg tracking-[0.3em] font-mono outline-none focus:ring-2"
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
            <Button type="submit" disabled={code.length < 4 || status === 'verifying'}>
              {status === 'verifying' ? 'Verifying…' : 'Sign in'}
            </Button>
            <div className="flex items-center justify-between mt-1">
              <button
                type="button"
                onClick={handleStartOver}
                className="text-xs underline underline-offset-2"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Use a different email
              </button>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Code expires in 60&nbsp;min
              </p>
            </div>
          </form>
        )}

        <p className="mt-6 text-[11px] leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
          FinSight is for accounting firms and bookkeepers. By signing in you agree
          your client data will be stored in our secure database, scoped to your
          firm, and never used to train AI models or sold to third parties.
        </p>
      </div>
      <p className="mt-4 text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
        <Link href="/legal/privacy" className="underline underline-offset-2 hover:opacity-80">
          Privacy
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/legal/terms" className="underline underline-offset-2 hover:opacity-80">
          Terms
        </Link>
      </p>
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
