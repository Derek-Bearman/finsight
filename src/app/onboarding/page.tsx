import { redirect } from 'next/navigation';
import { resolveUserContext } from '@/lib/data/context';
import { OnboardingFork } from '@/components/onboarding/OnboardingFork';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const ctx = await resolveUserContext();
  if (ctx.state === 'unauthenticated') redirect('/login?next=/onboarding');
  if (ctx.state === 'active') redirect('/');

  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold">Welcome to FinSight</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set up your firm to get started, or join a team you were invited to.
        </p>
      </div>
      <OnboardingFork />
    </main>
  );
}
