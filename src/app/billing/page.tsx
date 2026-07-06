import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveUserContext } from '@/lib/data/context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ManageBillingButton } from '@/components/billing/ManageBillingButton';

export const dynamic = 'force-dynamic';

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default async function BillingPage() {
  const ctx = await resolveUserContext();
  if (ctx.state === 'unauthenticated') redirect('/login?next=/billing');
  if (ctx.state === 'onboarding') redirect('/onboarding');

  const { firm, role, access } = ctx;

  return (
    <>
      <header className="border-b px-6 py-4" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <div className="mx-auto max-w-6xl">
          <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" data-testid="back-to-home">
            ← Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold">Billing</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {firm.name}
            <Badge variant={access.level === 'full' ? 'default' : 'destructive'}>{firm.plan_status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Access" value={access.level.replace('_', ' ')} />
          <Row label="Plan" value="$97 / month" />
          <Row label="Trial ends" value={fmt(firm.trial_ends_at)} />
          <Row label="Current period ends" value={fmt(firm.current_period_end)} />
          {firm.grace_ends_at && <Row label="Read-only grace until" value={fmt(firm.grace_ends_at)} />}
          <div className="pt-4">
            {role === 'owner' ? (
              <ManageBillingButton />
            ) : (
              <p className="text-muted-foreground">Only the firm owner can manage billing.</p>
            )}
          </div>
        </CardContent>
      </Card>
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
