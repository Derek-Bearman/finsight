import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * FinSight Privacy Policy — public, static server component.
 *
 * This page (with /legal/terms) is cited to Intuit as the hosted Privacy
 * Policy URL for the QuickBooks Online integration, so every claim in it
 * must stay true to how the app actually works. If the architecture
 * changes (new subprocessor, new data category, server-side sync), update
 * this page in the same change.
 */

export const metadata: Metadata = {
  title: 'Privacy Policy — FinSight',
  description: 'How FinSight collects, uses, and protects your data.',
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

export default function PrivacyPolicyPage() {
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
            <span className="font-medium text-foreground">Privacy</span>
            <Link href="/legal/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective date: {EFFECTIVE_DATE}
        </p>

        <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            FinSight is a financial analysis product for accounting firms and small
            businesses, operated by Arktos Marketing (Derek Bearman, sole proprietor,
            Missouri, USA). This policy describes what data FinSight collects, why,
            where it lives, and the choices you have. It is written to be read, not
            skimmed past. If anything here is unclear, email{' '}
            <a href="mailto:finsight@arktosmarketing.com" className="underline underline-offset-2">
              finsight@arktosmarketing.com
            </a>{' '}
            and a human will answer.
          </p>
        </div>

        <Section title="What we collect">
          <p>We collect three categories of data, and only these:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">Account information.</span>{' '}
              Your email address (used to sign you in with one-time codes) and the
              name of your firm.
            </li>
            <li>
              <span className="font-medium text-foreground">Firm and team information.</span>{' '}
              Your firm&apos;s workspaces, team member emails and roles, and billing
              status for your subscription.
            </li>
            <li>
              <span className="font-medium text-foreground">Client financial data you provide.</span>{' '}
              Financial statements, chart-of-accounts data, and related figures that
              you import into a workspace yourself, or that you authorize us to pull
              from a connected source such as QuickBooks Online. This data belongs to
              your firm and exists in FinSight only so the product can analyze it for
              you.
            </li>
          </ul>
          <p>
            We do not collect browsing history, contacts, location, or anything from
            your device beyond what is needed to run the app. There is no third-party
            analytics or advertising tracking in FinSight.
          </p>
        </Section>

        <Section title="QuickBooks Online connection">
          <p>
            FinSight can connect directly to QuickBooks Online to import a company&apos;s
            books. This connection works as follows:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">Read-only accounting access.</span>{' '}
              We request only the QuickBooks Online accounting scope. FinSight reads
              data from QuickBooks; it never writes to, edits, or deletes anything in
              your QuickBooks company.
            </li>
            <li>
              <span className="font-medium text-foreground">You control each connection.</span>{' '}
              Authorization happens per company, through Intuit&apos;s own OAuth consent
              screen, initiated by you. Connecting one client company grants access to
              that company only.
            </li>
            <li>
              <span className="font-medium text-foreground">What we pull.</span>{' '}
              The chart of accounts and historical monthly Profit &amp; Loss and Balance
              Sheet reports. This imported data is stored as part of your firm&apos;s
              workspace, exactly like data you import from a spreadsheet.
            </li>
            <li>
              <span className="font-medium text-foreground">How tokens are protected.</span>{' '}
              The OAuth tokens Intuit issues are encrypted at rest with AES-256-GCM
              using a key stored separately from the database, and they are never sent
              to or readable by web browsers. Only our server-side code can use them.
            </li>
            <li>
              <span className="font-medium text-foreground">Disconnect any time.</span>{' '}
              You can disconnect a company inside FinSight, or from Intuit&apos;s
              connected-apps page at any time. When a connection is disconnected, we
              delete its tokens. Previously imported financial data remains in your
              workspace (it is your firm&apos;s data) until you delete it or ask us to.
            </li>
          </ul>
        </Section>

        <Section title="Where your data lives">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              The application runs on Cloudflare Workers, served over HTTPS (TLS 1.2
              or higher).
            </li>
            <li>
              Data is stored in a Supabase-hosted Postgres database, encrypted at
              rest.
            </li>
            <li>
              Every row of firm data is protected by row-level security policies that
              isolate each firm&apos;s data from every other firm&apos;s. Your team can only
              read data belonging to your firm; this is enforced by the database
              itself, not just application code.
            </li>
          </ul>
        </Section>

        <Section title="Subprocessors">
          <p>
            We use a small set of infrastructure providers to run FinSight. Each one
            processes data only as needed to provide their service to us:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">Cloudflare</span> — application
              hosting and network delivery.
            </li>
            <li>
              <span className="font-medium text-foreground">Supabase</span> — database and
              authentication.
            </li>
            <li>
              <span className="font-medium text-foreground">Stripe</span> — subscription
              billing. Your card details go directly to Stripe; FinSight never sees or
              stores them.
            </li>
            <li>
              <span className="font-medium text-foreground">Resend</span> — transactional
              email (sign-in codes and account notices).
            </li>
            <li>
              <span className="font-medium text-foreground">Intuit</span> — when you connect
              QuickBooks Online, data flows between FinSight and Intuit&apos;s API under
              your authorization.
            </li>
          </ul>
        </Section>

        <Section title="What we never do">
          <ul className="list-disc space-y-2 pl-5">
            <li>We never sell your data, or your clients&apos; data, to anyone.</li>
            <li>We never use your data for advertising, and we run no ad trackers.</li>
            <li>
              We never use your financial data, or your clients&apos; financial data, to
              train AI models.
            </li>
            <li>
              We never share your data with third parties beyond the subprocessors
              listed above, except if required by law.
            </li>
          </ul>
        </Section>

        <Section title="Cookies">
          <p>
            FinSight uses only the cookies required to keep you signed in
            (authentication session cookies). There are no advertising, analytics, or
            cross-site tracking cookies.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            Your data is retained for as long as your firm has an account, so the
            product keeps working for you. If you cancel, your data remains available
            through the end of your billing period and a short grace window, in case
            you come back.
          </p>
          <p>
            You can delete workspaces and their data yourself inside the app at any
            time. To delete your entire account and all associated data, email{' '}
            <a href="mailto:finsight@arktosmarketing.com" className="underline underline-offset-2">
              finsight@arktosmarketing.com
            </a>{' '}
            and we will complete the deletion within 30 days and confirm it to you.
          </p>
        </Section>

        <Section title="If something goes wrong">
          <p>
            If we become aware of a security breach affecting your data, we will
            notify affected customers promptly by email with what happened, what data
            was involved, and what we are doing about it, and we will meet any
            notification obligations under applicable law and under our agreements
            with platform partners such as Intuit.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change this policy in a way that matters (new data category, new
            subprocessor, new use of data), we will update the effective date above
            and notify account owners by email before the change takes effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            FinSight is operated by Arktos Marketing (Derek Bearman), Missouri, USA.
            Questions, requests, or complaints:{' '}
            <a href="mailto:finsight@arktosmarketing.com" className="underline underline-offset-2">
              finsight@arktosmarketing.com
            </a>
            .
          </p>
        </Section>

        <footer
          className="mt-12 border-t pt-6 text-xs text-muted-foreground"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div className="flex items-center gap-3">
            <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms of Service
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
