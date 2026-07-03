import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AcceptInvite } from '@/components/onboarding/AcceptInvite';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Must be signed in (as the invited email) to accept — bounce to login and
  // return here afterward. Acceptance itself happens via the server action in
  // <AcceptInvite/>, which re-verifies the caller's confirmed email server-side.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/invite/${encodeURIComponent(token)}`);

  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <AcceptInvite token={token} />
    </main>
  );
}
