'use client';

/**
 * Firm app nav — the Team / Billing / (Admin) links shown in both app-page
 * headers. Reads the firm context; renders nothing when there's no active firm
 * (e.g. before hydration). Admin is shown only to allowlisted super-admins.
 */

import Link from 'next/link';
import { useFirmContext } from '@/components/app/firm-context';

export function AppNav() {
  const firm = useFirmContext();
  if (!firm) return null;

  const linkClass =
    'text-xs font-medium transition-colors rounded-md border px-2.5 py-1 hover:bg-muted whitespace-nowrap';
  const linkStyle = {
    borderColor: 'hsl(var(--border))',
    color: 'hsl(var(--muted-foreground))',
    background: 'hsl(var(--background))',
  } as const;

  return (
    <nav className="flex items-center gap-2" aria-label="Firm">
      <Link href="/team" className={linkClass} style={linkStyle} data-testid="nav-team">
        Team
      </Link>
      <Link href="/billing" className={linkClass} style={linkStyle} data-testid="nav-billing">
        Billing
      </Link>
      {firm.isSuperAdmin && (
        <Link href="/admin" className={linkClass} style={linkStyle} data-testid="nav-admin">
          Admin
        </Link>
      )}
    </nav>
  );
}
