import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/auth/super-admin';
import { listAllFirms } from '@/lib/admin/super-admin-data';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export default async function AdminPage() {
  // Gate the whole page: only allowlisted super-admins.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');
  if (!isSuperAdmin(user.email)) redirect('/');

  const firms = await listAllFirms();

  return (
    <>
      <header className="border-b px-6 py-4" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <div className="mx-auto max-w-6xl">
          <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" data-testid="back-to-home">
            ← Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Super-admin — Firms</h1>
        <p className="text-sm text-muted-foreground">
          Metadata console. No client financial data is ever shown here.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Firm</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Members</th>
              <th className="px-3 py-2">Clients</th>
              <th className="px-3 py-2">Trial ends</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {firms.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{f.name}</td>
                <td className="px-3 py-2">
                  <Badge variant={f.planStatus === 'active' || f.planStatus === 'trialing' ? 'default' : 'destructive'}>
                    {f.planStatus}
                  </Badge>
                </td>
                <td className="px-3 py-2">{f.memberCount}</td>
                <td className="px-3 py-2">{f.workspaceCount}</td>
                <td className="px-3 py-2">{fmt(f.trialEndsAt)}</td>
                <td className="px-3 py-2">{fmt(f.createdAt)}</td>
              </tr>
            ))}
            {firms.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                  No firms yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </main>
    </>
  );
}
