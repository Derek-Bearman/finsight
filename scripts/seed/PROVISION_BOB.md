# Provisioning Bob Volpe's Complimentary Firm

Proven end-to-end 2026-07-07 with a throwaway user (`bobtest@finsight.test`,
firm "Volpe Test Firm (DELETE ME)" — deleted after verification). Repeat with
Bob's real email once Derek supplies it. Total time: ~2 minutes.

All SQL runs through the Supabase MCP (`execute_sql`, project
`camphmqvrzqpgrhdjafo`). The workspace insert goes through the authenticated
REST API so RLS is exercised exactly like the app.

## 1. Create Bob's auth user

Passwordless OTP is the normal login; the password below exists only so step 3
can mint a token for seeding — it is NOT shared with Bob (he signs in by email
code). Token columns must be `''` (GoTrue 500s on NULL for hand-inserted rows).

```sql
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  '<BOB_EMAIL>',
  crypt(gen_random_uuid()::text, gen_salt('bf')),  -- unusable password; OTP is the login
  now(), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
)
returning id;  -- => BOB_UID
```

For seeding you need a temporary known password. Either set one and scramble it
after seeding, or seed via service-role SQL insert instead (step 4 alternative).

## 2. Create the firm (complimentary = plan_status 'active', no billing gates)

```sql
select public.create_firm_with_owner(
  'Volpe Consulting & Accounting',
  '<BOB_UID>',
  p_plan_status => 'active'
) as firm_id;  -- => FIRM_ID
```

Bob is OWNER — he sees /team and /billing surfaces.

## 3. Seed the sample client (authenticated REST path)

```bash
# regenerate the deterministic sample blob
npx tsx scripts/seed/build-volpe-sample.ts > /tmp/volpe-sample-client.json

# temporary password for the seeding token (scramble in step 5)
# SQL: update auth.users set encrypted_password = crypt('<TEMP_PW>', gen_salt('bf')) where id = '<BOB_UID>';

SUPA=https://camphmqvrzqpgrhdjafo.supabase.co
KEY=sb_publishable_wiFj4325ez0dD6O7ZYN6GA_igE_c9ov
TOKEN=$(curl -s -X POST "$SUPA/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"<BOB_EMAIL>","password":"<TEMP_PW>"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

python3 - <<'EOF'
import json
ws = json.load(open('/tmp/volpe-sample-client.json'))
json.dump({"firm_id": "<FIRM_ID>", "name": ws["name"], "industry_profile": ws["industryProfileId"], "data": ws}, open('/tmp/volpe-row.json','w'))
EOF

curl -s -X POST "$SUPA/rest/v1/workspaces?select=id,version,name" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  --data @/tmp/volpe-row.json
```

The sample client is **Bella Roma Pizza #42** — a franchise pizza restaurant
with 12 months of balanced P&L + BS, marketing-funnel shared inputs (spend,
leads, appointments, new customers, new-customer revenue), restaurant
operational inputs (labor, covers, seats, beverage revenue), and
corporate-mandated targets (food cost ≤ 30%, labor ≤ 28%, prime ≤ 60%,
net margin ≥ 8%, gross ≥ 68%, plus custom current ratio ≥ 1.2 and CAC ≤ $45).
Every new feature demos itself: exec summary, funnel chart, targets with
provenance, shared-input entry.

Leave the rest of the firm EMPTY — Bob creating his own clients from scratch
is the stress test.

## 4. Scramble the temporary password

```sql
update auth.users
set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf'))
where id = '<BOB_UID>';
```

## 5. Verify

- `select id, name, plan_status from firms where id = '<FIRM_ID>';` → active
- Prod: sign in as Bob would (email OTP) or via headless-auth, open the
  workspace, confirm exec summary + funnel + targets render.

## Cleanup used for the test run

```sql
delete from public.firms where id = '<TEST_FIRM_ID>';   -- cascades workspace + membership
delete from auth.users where email = 'bobtest@finsight.test';
```
