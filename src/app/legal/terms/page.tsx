import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * FinSight Terms of Service / EULA — public, static server component.
 *
 * This page (with /legal/privacy) is cited to Intuit as the hosted EULA URL
 * for the QuickBooks Online integration. Keep it accurate to how the product
 * actually bills and behaves; update it in the same change as any pricing or
 * policy shift.
 */

export const metadata: Metadata = {
  title: 'Terms of Service — FinSight',
  description: 'The terms that govern your use of FinSight.',
};

const EFFECTIVE_DATE = 'July 22, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="mx-auto flex max-w-3xl items-baseline justify-between">
          <Link href="/" className="text-sm font-bold tracking-tight">
            FinSight
          </Link>
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <span className="font-medium text-foreground">Terms</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective date: {EFFECTIVE_DATE}
        </p>

        <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            These terms are an agreement between you (the firm or individual using
            FinSight) and Arktos Marketing (Derek Bearman, sole proprietor, Missouri,
            USA), the operator of FinSight. By creating an account or using the
            service you agree to them. Questions:{' '}
            <a href="mailto:finsight@arktosmarketing.com" className="underline underline-offset-2">
              finsight@arktosmarketing.com
            </a>
            .
          </p>
        </div>

        <Section title="1. The service">
          <p>
            FinSight is a web application that helps accounting firms and small
            businesses analyze financial statements: importing historical Profit &amp;
            Loss and Balance Sheet data (from spreadsheets or an authorized
            QuickBooks Online connection), classifying accounts, projecting
            performance, and running what-if scenarios. We may add, change, or
            improve features over time.
          </p>
        </Section>

        <Section title="2. Not financial, tax, or investment advice">
          <div
            className="rounded-lg border px-4 py-3"
            style={{
              borderColor: 'hsl(var(--warning))',
              background: 'hsl(var(--warning) / 0.08)',
            }}
          >
            <p className="font-medium text-foreground">
              FinSight is analytics tooling only. Nothing the product produces
              (metrics, projections, scenarios, classifications, or any other output)
              is financial, tax, accounting, legal, or investment advice, and no
              output creates an advisor-client relationship.
            </p>
          </div>
          <p>
            Projections and scenarios are arithmetic on the assumptions you supply.
            They are not predictions, and real results will differ. You and your
            clients are responsible for all decisions made using the service, and
            professional judgment (yours, or that of a licensed professional you
            engage) must be applied to any output before relying on it.
          </p>
        </Section>

        <Section title="3. Subscription and billing">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              FinSight costs <span className="font-medium text-foreground">$97 per month per firm</span>,
              billed through Stripe.
            </li>
            <li>
              New firms get a <span className="font-medium text-foreground">7-day free trial</span>.
              A payment card is required up front; the first charge happens when the
              trial ends unless you cancel before then.
            </li>
            <li>
              You can cancel any time from the billing portal in the app. Cancellation
              takes effect at the end of the current billing period; you keep access
              until then. We do not prorate or refund partial months.
            </li>
            <li>
              If we change pricing, existing subscribers get at least 30 days notice
              by email before a new price applies to them.
            </li>
          </ul>
        </Section>

        <Section title="4. Your account">
          <p>
            You are responsible for the accuracy of the information you provide, for
            the actions taken under your firm&apos;s accounts, and for ensuring the people
            you invite to your firm are authorized to see the client data in it. Keep
            your sign-in email secure; anyone who can receive codes at that address
            can access your account.
          </p>
          <p>
            You must have the right to upload or connect the financial data you bring
            into FinSight. If you connect a client&apos;s QuickBooks Online company or
            import a client&apos;s statements, you represent that the client has
            authorized you to do so.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>use the service for anything unlawful or fraudulent;</li>
            <li>
              attempt to access another firm&apos;s data, probe or circumvent our security
              controls, or test the service for vulnerabilities without written
              permission;
            </li>
            <li>
              resell, sublicense, or provide the service to third parties as your own
              offering (using it to serve your accounting clients is of course fine;
              that is what it is for);
            </li>
            <li>
              scrape, bulk-export for redistribution, or reverse engineer the service;
            </li>
            <li>interfere with or disrupt the service or other customers&apos; use of it.</li>
          </ul>
          <p>
            We may suspend or terminate accounts that violate these terms, with
            notice where practical.
          </p>
        </Section>

        <Section title="6. Your data">
          <p>
            <span className="font-medium text-foreground">Your firm owns its data.</span>{' '}
            Everything you import, connect, or create in FinSight (client financial
            data, workspaces, scenarios) belongs to your firm. We process it only to
            provide the service, as described in our{' '}
            <Link href="/legal/privacy" className="underline underline-offset-2">
              Privacy Policy
            </Link>
            . We act as a processor of your clients&apos; financial data on your behalf;
            you remain responsible for having the right to use that data.
          </p>
          <p>
            You can export or delete your data at any time, and can request full
            account deletion as described in the Privacy Policy.
          </p>
        </Section>

        <Section title="7. Availability">
          <p>
            We work to keep FinSight fast and available, but the service is provided
            on a best-effort basis, without an uptime guarantee or SLA. The service
            is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any kind,
            express or implied, including merchantability, fitness for a particular
            purpose, and non-infringement. Third-party dependencies (including
            Intuit&apos;s QuickBooks Online API) can affect features that rely on them.
          </p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>
            To the maximum extent permitted by law, Arktos Marketing&apos;s total
            liability for any claims arising out of or relating to the service is
            capped at the subscription fees you paid us in the 12 months before the
            event giving rise to the claim. We are not liable for indirect,
            incidental, special, consequential, or punitive damages, or for lost
            profits, lost data, or business interruption, even if advised of the
            possibility. Nothing in these terms limits liability that cannot be
            limited under applicable law.
          </p>
        </Section>

        <Section title="9. Changes to these terms">
          <p>
            If we make a material change to these terms, we will update the effective
            date above and notify account owners by email at least 14 days before the
            change takes effect. Continuing to use the service after that date means
            you accept the updated terms. If you do not accept them, cancel before
            they take effect.
          </p>
        </Section>

        <Section title="10. Governing law">
          <p>
            These terms are governed by the laws of the State of Missouri, USA,
            without regard to conflict-of-law rules. Any disputes will be resolved in
            the state or federal courts located in Missouri, and both parties consent
            to their jurisdiction.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Arktos Marketing (Derek Bearman), Missouri, USA.{' '}
            <a href="mailto:finsight@arktosmarketing.com" className="underline underline-offset-2">
              finsight@arktosmarketing.com
            </a>
          </p>
        </Section>

        <footer
          className="mt-12 border-t pt-6 text-xs text-muted-foreground"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div className="flex items-center gap-3">
            <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/login" className="underline underline-offset-2 hover:text-foreground">
              Sign in
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
