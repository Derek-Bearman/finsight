import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveUserContext } from '@/lib/data/context';
import { FranchiseManager } from '@/components/franchise/FranchiseManager';
import { PageTutor, WORKSPACE_TOUR_KEY, WORKSPACE_TOUR_STEPS } from '@/components/tutorial';

export const dynamic = 'force-dynamic';

export default async function FranchisesPage() {
  const ctx = await resolveUserContext();
  if (ctx.state === 'unauthenticated') redirect('/login?next=/franchises');
  if (ctx.state === 'onboarding') redirect('/onboarding');

  return (
    <>
      <header className="border-b px-6 py-4" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-3">
          <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" data-testid="back-to-home">
            ← Home
          </Link>
          <PageTutor
            mainTour={{ steps: WORKSPACE_TOUR_STEPS, storageKey: WORKSPACE_TOUR_KEY, label: 'Workspace tour', autoOpen: false }}
            pageId="franchises"
            pageTitle="Franchises"
          />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{ctx.firm.name} — Franchises</h1>
        <p className="text-sm text-muted-foreground">
          Franchise-wide benchmark sets and corporate charts of accounts shared by linked clients.
        </p>
      </div>
      <FranchiseManager />
      </main>
    </>
  );
}
