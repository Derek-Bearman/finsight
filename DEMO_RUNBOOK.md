# Public Demo — how it works and how to fix it

The `/login` page has an **"Explore the live demo"** button. It signs the
visitor in as a real (throwaway) user via password grant — no email involved —
and lands them in a shared sandbox firm.

## The pieces

| Piece | Value |
|---|---|
| Demo user | `demo@finsight.test` / `FinSightDemo!2026` (public by design; ships in the client bundle) |
| Demo user id | `49fa87b7-4f93-4145-a8e4-860203472859` |
| Sandbox firm | "Demo Advisory Group", id `3f66a9a8-598b-441c-89e9-de190c60c9be`, `plan_status='active'` |
| Roles | `bearman.derek@outlook.com` = **owner**; demo user = **member** (cannot invite teammates or reach owner-only billing actions — containment against invite-spam abuse) |
| Seeded client | Bella Roma Pizza #42, from `scripts/seed/build-volpe-sample.ts` (deterministic) |
| Nightly reset | `finsight-keepalive` Worker (`~/finsight-keepalive`), daily cron 06:00 UTC: signs in as the demo user, deletes all demo-firm workspaces, reinserts the canonical sample. Manual trigger: `GET /reseed` on the worker's workers.dev URL with header `x-reseed-key` (see its wrangler.jsonc vars). |

Note this is separate from **"Arktos Advisory"** — Derek's curated 3-client
walkthrough firm. Public visitors never touch that one.

## If the demo button stops working

Most likely cause: a visitor changed the demo account's password via the auth
API (`supabase.auth.updateUser`). Re-assert it (Supabase MCP `execute_sql`,
project `camphmqvrzqpgrhdjafo`):

```sql
update auth.users
set encrypted_password = crypt('FinSightDemo!2026', gen_salt('bf'))
where email = 'demo@finsight.test';
```

Then hit the keepalive worker's `/reseed` endpoint (or wait for the nightly
cron) to restore the sample client.

## If the sample client is trashed mid-day

`curl -H "x-reseed-key: <RESEED_KEY from ~/finsight-keepalive/wrangler.jsonc>" https://finsight-keepalive.bearman-derek.workers.dev/reseed`

## Regenerating the canonical blob after seed-script changes

```bash
cd ~/Documents/finsight
npx tsx scripts/seed/build-volpe-sample.ts > /tmp/sample.json
# then rebuild ~/finsight-keepalive/src/sample-workspace.js from it and redeploy
```
