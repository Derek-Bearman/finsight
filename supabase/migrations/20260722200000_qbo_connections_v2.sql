-- ─────────────────────────────────────────────────────────────────────────────
-- QBO connections v2 — adversarial-review fixes (2026-07-22). STRICTLY ADDITIVE
-- to live-app behavior (new column, corrected trigger fn, new service-only
-- table); the live app reads none of these objects.
--
-- 1. refresh_claimed_at — CAS claim so only ONE server invocation per realm
--    ever calls Intuit's token refresh at a time (Intuit anti-replay can
--    revoke the whole token family on concurrent refreshes; plan §1).
-- 2. Pin-trigger fix: connected_by is legitimately rewritten on reconnect
--    (upsertConnection), so stop pinning it. firm_id/workspace_id/realm_id
--    stay immutable.
-- 3. qbo_oauth_nonces — atomic single-use consumption of the OAuth callback
--    nonce BEFORE the code exchange (a double-fired callback must never
--    exchange the auth code twice; the second exchange invalidates the
--    first's tokens).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.qbo_connections
  add column if not exists refresh_claimed_at timestamptz;

comment on column public.qbo_connections.refresh_claimed_at is
  'CAS claim: set atomically (guarded on refresh_token_enc + staleness) before '
  'calling Intuit''s token refresh; cleared when the rotated pair is persisted. '
  'Prevents concurrent refreshes for one realm (token-family revocation).';

-- Corrected immutability pin (connected_by no longer pinned).
create or replace function public.qbo_connections_pin_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.firm_id      := old.firm_id;
  new.workspace_id := old.workspace_id;
  new.realm_id     := old.realm_id;
  new.created_at   := old.created_at;
  return new;
end;
$$;

-- Single-use OAuth callback nonces. Service-role only; rows are throwaway
-- (10-minute state lifetime) and opportunistically purged by the callback.
create table if not exists public.qbo_oauth_nonces (
  nonce      text primary key,
  created_at timestamptz not null default now()
);

comment on table public.qbo_oauth_nonces is
  'Single-use OAuth callback nonces (insert-once = consume). Service-role only.';

alter table public.qbo_oauth_nonces enable row level security;
revoke all on table public.qbo_oauth_nonces from public, anon, authenticated;
