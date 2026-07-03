'use client';

/**
 * Billing status banner. Pure/presentational — takes the resolved AccessDecision
 * and renders the appropriate message. Shown at the top of the firm app so users
 * see trial-ending / past-due / locked states. `locked` callers should render
 * this AND block the app content; this component only shows the message.
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { AccessDecision } from '@/lib/billing/access';

export function BillingBanner({
  decision,
  onManageBilling,
}: {
  decision: AccessDecision;
  onManageBilling?: () => void;
}) {
  if (!decision.banner) return null;
  const { severity, message } = decision.banner;
  const isError = severity === 'error';
  const title =
    severity === 'error' ? 'Account locked' : severity === 'warning' ? 'Payment needs attention' : 'Heads up';

  return (
    <Alert
      variant={isError ? 'destructive' : 'default'}
      className={
        severity === 'warning'
          ? 'border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200'
          : severity === 'info'
            ? 'border-primary/30'
            : undefined
      }
      data-severity={severity}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{message}</span>
        {onManageBilling && (
          <button
            type="button"
            onClick={onManageBilling}
            className="font-medium underline underline-offset-4 hover:no-underline"
          >
            Manage billing
          </button>
        )}
      </AlertDescription>
    </Alert>
  );
}
