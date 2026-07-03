-- ============================================================================
-- FinSight — Phase 4 groundwork: billing write funnel (apply_stripe_status)
-- ============================================================================
-- The review flagged that any service_role path could `update firms set
-- plan_status=...` ad hoc and silently grant free access. This funnels ALL
-- billing writes through ONE service-role RPC so the surface is auditable and
-- consistent, and adds an explicit `grace_ends_at` anchor for the ~3-day
-- read-only grace on past_due (the app's access-state machine reads it; see
-- src/lib/billing/access.ts). Idempotent.
--
-- Stripe subscription.status values map 1:1 onto firms.plan_status (the CHECK
-- constraint already lists them), so the webhook passes the status straight
-- through; an out-of-set value is rejected by the CHECK (fails safe).
-- ============================================================================

alter table public.firms add column if not exists grace_ends_at timestamptz;
comment on column public.firms.grace_ends_at is
  'When plan_status=past_due, the end of the read-only grace window (set by apply_stripe_status). NULL otherwise.';

create or replace function public.apply_stripe_status(
  p_stripe_customer_id     text,
  p_status                 text,
  p_current_period_end     timestamptz default null,
  p_stripe_subscription_id text default null,
  p_grace_days             int default 3
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id    uuid;
  v_old_status text;
  v_old_grace  timestamptz;
  v_grace      timestamptz;
begin
  select id, plan_status, grace_ends_at
    into v_firm_id, v_old_status, v_old_grace
  from public.firms where stripe_customer_id = p_stripe_customer_id;

  if v_firm_id is null then
    raise exception 'no firm for stripe customer %', p_stripe_customer_id using errcode = 'no_data_found';
  end if;

  -- Grace anchor: start the window when ENTERING past_due; keep it stable across
  -- repeated past_due webhooks (don't extend); clear it on any other status.
  if p_status = 'past_due' then
    if v_old_status = 'past_due' and v_old_grace is not null then
      v_grace := v_old_grace;
    else
      v_grace := now() + make_interval(days => p_grace_days);
    end if;
  else
    v_grace := null;
  end if;

  update public.firms set
    plan_status            = p_status,
    current_period_end     = coalesce(p_current_period_end, current_period_end),
    stripe_subscription_id = coalesce(p_stripe_subscription_id, stripe_subscription_id),
    grace_ends_at          = v_grace
  where id = v_firm_id;

  insert into public.audit_log (firm_id, actor_user_id, action, target, metadata)
  values (v_firm_id, null, 'billing.status_changed', 'firm:' || v_firm_id,
          jsonb_build_object('from', v_old_status, 'to', p_status,
                             'grace_ends_at', v_grace));

  return v_firm_id;
end;
$$;

comment on function public.apply_stripe_status(text, text, timestamptz, text, int) is
  'SERVICE-ROLE ONLY. The single funnel for billing-state writes to firms (Stripe webhooks). Sets plan_status/period/grace + audit. Repeated past_due webhooks do not extend the grace window.';

revoke all on function public.apply_stripe_status(text, text, timestamptz, text, int) from public, anon, authenticated;
grant  execute on function public.apply_stripe_status(text, text, timestamptz, text, int) to service_role;
