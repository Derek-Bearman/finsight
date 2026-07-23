/**
 * GET /api/qbo/callback — Intuit's OAuth redirect target (exact-match
 * registered URI). Receives ?code&state&realmId on success, ?error&state when
 * the user cancels on the consent screen.
 *
 * This route sits on middleware PUBLIC_PATHS (the login bounce drops query
 * strings, which would kill the flow — plan §2.4), so it must be resilient to
 * a SESSION-LESS arrival: the signed state carries {user, firm, workspace}
 * identity, and authorization is re-proven via the SERVICE client (workspace
 * still belongs to firm f; user u still holds an active owner/admin
 * membership of firm f; firm f still has 'full' billing access — the same
 * gate /api/qbo/connect enforced) before anything is stored.
 *
 * Replay guards (plan §1: auth codes are single-use — a duplicate exchange
 * invalidates the first exchange's tokens):
 *  - state signature + 10-min expiry (verifyState),
 *  - the nonce is consumed ATOMICALLY right before the exchange (insert-once
 *    into service-only qbo_oauth_nonces): a double-fired callback hits the
 *    unique violation on the second fire and exits as an idempotent success
 *    WITHOUT a second exchange,
 *  - nonce cookie must match state.n and is CLEARED on first use
 *    (defense-in-depth on top of the atomic consumption),
 *  - the code is exchanged exactly once, inside the try/catch.
 *
 * realm_in_use guard (unique(firm_id, realm_id) — plan §2.1): connecting a
 * company already wired to ANOTHER workspace in the firm is detected BEFORE
 * the code exchange (realmId arrives on the redirect query), so the
 * single-use code isn't burned on a doomed connect; the residual race
 * surfaces as the typed QboRealmInUseError from upsertConnection.
 *
 * All exits 302 back into the app (?qbo=connected / ?qbo_error=<reason>) —
 * raw errors are never rendered.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveAccess } from '@/lib/billing/access';
import { getQboEnv, qboApiBaseUrl } from '@/lib/qbo/config';
import { exchangeCode } from '@/lib/qbo/oauth';
import { verifyState } from '@/lib/qbo/state';
import { fetchCompanyInfo, type QboApiContext } from '@/lib/qbo/api';
import { QboRealmInUseError, upsertConnection } from '@/lib/qbo/connections';

/** Single-use CSRF nonce cookie — must match the connect route exactly. */
const NONCE_COOKIE = 'qbo_oauth_nonce';

/** Same shared-demo guard as workspace-actions.ts / qbo-actions.ts. */
const DEMO_FIRM_ID = process.env.DEMO_FIRM_ID ?? '3f66a9a8-598b-441c-89e9-de190c60c9be';

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const params = url.searchParams;

  /** 302 into the app, ALWAYS clearing the nonce cookie (single-use: once a
   *  callback has been processed — success or failure — the flow is spent). */
  const respond = (pathname: string, query: Record<string, string>): NextResponse => {
    const target = url.clone();
    target.pathname = pathname;
    target.search = '';
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    const res = NextResponse.redirect(target);
    res.cookies.set(NONCE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/api/qbo', maxAge: 0 });
    return res;
  };

  let env;
  try {
    env = getQboEnv();
  } catch (err) {
    console.error('qbo callback: env not configured', err);
    return respond('/', { qbo_error: 'not_configured' });
  }

  // Verify the state first — every later decision (including where to send
  // the user) hangs off its authenticated payload.
  const stateParam = params.get('state');
  const state = stateParam ? await verifyState(stateParam, env.stateSecret) : null;

  // User canceled on Intuit's consent screen (?error=access_denied).
  if (params.get('error')) {
    return respond(state ? `/workspace/${state.w}` : '/', { qbo_error: 'denied' });
  }

  if (!state) return respond('/', { qbo_error: 'invalid_state' });
  const target = `/workspace/${state.w}`;

  // Nonce cookie must match the signed state — proves the returning browser
  // started this flow, and (being cleared on every exit) makes it single-use.
  const cookieNonce = request.cookies.get(NONCE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== state.n) {
    return respond(target, { qbo_error: 'invalid_state' });
  }

  const code = params.get('code');
  const realmId = params.get('realmId');
  if (!code || !realmId) return respond(target, { qbo_error: 'exchange_failed' });

  const service = createSupabaseServiceClient();
  try {
    // Session-less authorization re-proof via the service client: the signed
    // state names {u, f, w}; verify those bindings still hold RIGHT NOW.
    if (state.f === DEMO_FIRM_ID) return respond(target, { qbo_error: 'forbidden' });

    const { data: workspace, error: wsError } = await service
      .from('workspaces')
      .select('id, firm_id')
      .eq('id', state.w)
      .maybeSingle();
    if (wsError) throw wsError;
    if (!workspace || workspace.firm_id !== state.f) {
      return respond(target, { qbo_error: 'forbidden' });
    }

    const { data: membership, error: memberError } = await service
      .from('memberships')
      .select('role')
      .eq('user_id', state.u)
      .eq('firm_id', state.f)
      .eq('status', 'active')
      .maybeSingle();
    if (memberError) throw memberError;
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return respond(target, { qbo_error: 'forbidden' });
    }

    // Billing re-proof, mirroring /api/qbo/connect's 'full' gate: the state
    // is at most 10 minutes old, but access can lapse mid-flow, and a stored
    // connection is a live books feed — re-check before storing anything.
    const { data: firm, error: firmError } = await service
      .from('firms')
      .select('plan_status, trial_ends_at, current_period_end, grace_ends_at')
      .eq('id', state.f)
      .maybeSingle();
    if (firmError) throw firmError;
    if (!firm || resolveAccess(firm).level !== 'full') {
      return respond(target, { qbo_error: 'billing' });
    }

    // The company may already be wired to a DIFFERENT workspace in this firm
    // (unique(firm_id, realm_id)). Detect it BEFORE the exchange — hitting
    // the constraint after exchanging would burn the single-use code on a
    // connect that can never succeed.
    const { data: realmHolder, error: realmError } = await service
      .from('qbo_connections')
      .select('workspace_id')
      .eq('firm_id', state.f)
      .eq('realm_id', realmId)
      .neq('workspace_id', state.w)
      .maybeSingle();
    if (realmError) throw realmError;
    if (realmHolder) return respond(target, { qbo_error: 'realm_in_use' });

    // Consume the nonce ATOMICALLY before the exchange: insert-once into
    // qbo_oauth_nonces. A double-fired callback (browser retry, duplicate
    // tab, proxy replay) hits the unique violation on the second fire and
    // exits as an idempotent success WITHOUT exchanging — a duplicate
    // exchange would invalidate the first exchange's tokens. The cookie
    // check above stays as defense-in-depth.
    const { error: nonceError } = await service
      .from('qbo_oauth_nonces')
      .insert({ nonce: state.n });
    if (nonceError) {
      if (nonceError.code === '23505') {
        // Already consumed: the first fire is doing (or has done) the work.
        return respond(target, { qbo: 'connected' });
      }
      throw nonceError;
    }

    // Opportunistic hygiene: purge day-old nonces (states live 10 minutes).
    // Best-effort — a purge hiccup must never block the connect.
    const { error: purgeError } = await service
      .from('qbo_oauth_nonces')
      .delete()
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    if (purgeError) console.error('qbo nonce purge failed', purgeError.message);

    // Exchange the code EXACTLY ONCE (single-use; a duplicate exchange would
    // invalidate this exchange's tokens).
    const tokens = await exchangeCode(env, { code });

    // One-off API context: the just-issued access token, no refresh path.
    const apiCtx: QboApiContext = {
      baseUrl: qboApiBaseUrl(env),
      realmId,
      getAccessToken: async () => tokens.accessToken,
    };
    const companyName = (await fetchCompanyInfo(apiCtx)).CompanyName;

    await upsertConnection({
      firmId: state.f,
      workspaceId: state.w,
      realmId,
      companyName,
      tokens,
      connectedBy: state.u,
    });

    return respond(target, { qbo: 'connected' });
  } catch (err) {
    console.error('qbo callback failed', err);
    // Audit the failure (best-effort — the redirect must go out regardless).
    try {
      await service.from('audit_log').insert({
        firm_id: state.f,
        action: 'qbo.connect_failed',
        actor_user_id: state.u,
        target: state.w,
        metadata: {
          realmId,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } catch (auditErr) {
      console.error('qbo callback failure audit write failed', auditErr);
    }
    // Residual unique(firm_id, realm_id) race (pre-check passed, a concurrent
    // connect landed first) gets its precise reason; everything else is a
    // generic exchange failure.
    return respond(target, {
      qbo_error: err instanceof QboRealmInUseError ? 'realm_in_use' : 'exchange_failed',
    });
  }
}
