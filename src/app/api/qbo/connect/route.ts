/**
 * GET /api/qbo/connect?workspaceId=… — kicks off the QBO OAuth flow.
 *
 * Auth: standard session (this route is NOT on PUBLIC_PATHS, so the proxy
 * already bounced anonymous requests to /login), then the same gates as the
 * QBO server actions: active firm, workspace-in-firm (RLS fetch), owner/admin
 * role, demo firm blocked, billing 'full'.
 *
 * Flow binding (plan §2.4): a signed state {u, f, w, n, exp(+10min)} carries
 * the authz across Intuit's redirect (the callback sits on PUBLIC_PATHS), and
 * the nonce is ALSO set as an httpOnly SameSite=Lax cookie scoped to
 * /api/qbo so the callback can prove the browser that returns is the browser
 * that started (CSRF/replay guard; cleared on first use).
 *
 * Failures never render raw errors — they 302 back into the app with
 * ?qbo_error=<reason> for the workspace UI to surface.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { resolveUserContext } from '@/lib/data/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getQboEnv } from '@/lib/qbo/config';
import { buildAuthorizeUrl } from '@/lib/qbo/oauth';
import { buildState, makeNonce } from '@/lib/qbo/state';

/** Single-use CSRF nonce cookie — must match the callback route exactly. */
const NONCE_COOKIE = 'qbo_oauth_nonce';
const STATE_TTL_MS = 10 * 60_000;

/** Same shared-demo guard as workspace-actions.ts / qbo-actions.ts. */
const DEMO_FIRM_ID = process.env.DEMO_FIRM_ID ?? '3f66a9a8-598b-441c-89e9-de190c60c9be';

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;

  const fail = (reason: string, workspaceId?: string | null): NextResponse => {
    const target = url.clone();
    target.pathname = workspaceId ? `/workspace/${workspaceId}` : '/';
    target.search = '';
    target.searchParams.set('qbo_error', reason);
    return NextResponse.redirect(target);
  };

  const workspaceId = url.searchParams.get('workspaceId');
  if (!workspaceId) return fail('missing_workspace');

  const ctx = await resolveUserContext();
  if (ctx.state !== 'active') return fail('forbidden');
  if (ctx.role !== 'owner' && ctx.role !== 'admin') return fail('forbidden', workspaceId);
  if (ctx.firm.id === DEMO_FIRM_ID) return fail('forbidden', workspaceId);
  if (ctx.access.level !== 'full') return fail('billing', workspaceId);

  // Workspace must belong to the caller's firm (RLS scopes the read; the
  // firm_id equality is re-checked explicitly on top).
  const supabase = await createSupabaseServerClient();
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('id, firm_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error || !workspace || workspace.firm_id !== ctx.firm.id) {
    return fail('workspace_not_found');
  }

  let env;
  try {
    env = getQboEnv();
  } catch (err) {
    console.error('qbo connect: env not configured', err);
    return fail('not_configured', workspaceId);
  }

  const nonce = makeNonce();
  const state = await buildState(
    { u: ctx.userId, f: ctx.firm.id, w: workspaceId, n: nonce, exp: Date.now() + STATE_TTL_MS },
    env.stateSecret
  );

  const res = NextResponse.redirect(buildAuthorizeUrl(env, { state }));
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax', // sent on the top-level GET navigation back from Intuit
    path: '/api/qbo', // only the qbo routes ever see it
    maxAge: 600, // matches the state's 10-minute expiry
    secure: env.redirectOrigin.startsWith('https://'),
  });
  return res;
}
