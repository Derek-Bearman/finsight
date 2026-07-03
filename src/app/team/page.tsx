import { redirect } from 'next/navigation';
import { resolveUserContext } from '@/lib/data/context';
import { listMembers } from '@/lib/data/team';
import { TeamManager } from '@/components/team/TeamManager';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const ctx = await resolveUserContext();
  if (ctx.state === 'unauthenticated') redirect('/login?next=/team');
  if (ctx.state === 'onboarding') redirect('/onboarding');

  const membersRes = await listMembers(ctx.firm.id);
  const members = membersRes.ok ? membersRes.data : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{ctx.firm.name} — Team</h1>
        <p className="text-sm text-muted-foreground">Invite teammates and manage their roles.</p>
      </div>
      <TeamManager
        firmId={ctx.firm.id}
        currentRole={ctx.role}
        currentUserId={ctx.userId}
        initialMembers={members}
      />
    </main>
  );
}
