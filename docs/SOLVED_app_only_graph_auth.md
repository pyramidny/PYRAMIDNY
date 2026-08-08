# SOLVED — SharePoint writes died an hour after login (app-only Graph auth)

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**Module:** `supabase/functions/project-proxy/index.ts` — all Microsoft Graph calls
**Date:** 2026-08-04
**Status:** DEPLOYED & VERIFIED in production (P-0011). Long-duration test pending.

---

## PROBLEM
Document upload failed on a live project with:

```
Upload failed: providerToken required for SharePoint upload
```

Worse, the same project had been created minutes earlier **with no SharePoint
folders at all** and no error shown. P-0007, P-0008 and P-0009 were all
folderless. P-0006 (created June 19) had folders and looked fine, which is what
made this hard to see — it worked when you tested it and broke later.

## ROOT CAUSE
Two independent faults stacked.

**1. The Graph token expires and nothing refreshes it.**
Every SharePoint call in the app ran on `provider_token` — the Microsoft Graph
delegated token Supabase captures at OAuth login and writes to
`localStorage['sb-izjaxmcdlsdkdliqjlei-auth-token']`.

Supabase does not refresh that token, and does not carry it forward through a
session refresh. Microsoft Graph access tokens live roughly one hour.

So the entire SharePoint layer only worked for about **an hour after a fresh
Microsoft sign-in**. Pyramid staff stay signed in for days. In normal use the
token was almost always already dead.

Likely accelerant: the auth-lock fix (SOLVED_auth_lock_race, 2026-07-11)
restored correct session refreshing. Sessions now refresh often, and each
refresh leaves `provider_token` behind — so fixing the freeze made this failure
far more frequent.

**2. Folder creation failed silently.**
`project-proxy` line 302 was:

```ts
let spResult = null;
if (providerToken) {
  ... create folder tree ...
}
```

No `else`. No error. No log. A missing or expired token meant the project saved,
reported success, and had no folders — surfacing later as an unrelated-looking
upload error.

## FIX
**App-only (client credentials) Graph auth**, replacing the user token entirely.

- Added `getGraphToken()` to `project-proxy`: client-credentials grant against
  the **PYRAMID COMMAND CENTER** registration
  (`ac2882ee-091b-4fcf-bb83-5e242d41b6a7`, tenant
  `0bda4089-c5c1-4cd9-93a0-7953e6687bbc`). Two-layer cache — in-memory for warm
  isolates, `public.graph_token_cache` for cold starts — refreshed 5 minutes
  before expiry.
- **One swap point.** `providerToken` is reassigned once at handler entry:
  ```ts
  const providerToken = (await getGraphToken()) ?? callerProviderToken ?? null;
  ```
  All six existing Graph call sites were left untouched. Smallest possible
  change surface; nothing else could regress.
- **New `graph_health` action** — mints a token, probes the drive root, returns
  `client_id` / `tenant_id` / `secret_present` so the active registration can be
  confirmed without guessing. Also the endpoint the New Project form banner will
  call.
- **Silent failure closed.** Folder provisioning now reports: the project still
  saves if Graph fails (DB is authoritative), but the response carries a
  `warning` and it is logged. `sharepoint_folder_id IS NULL` is the signal that
  a project still needs folders.

**No new Azure secret was needed.** `MS_TENANT_ID`, `MS_CLIENT_ID` and
`MS_CLIENT_SECRET` were already in Supabase secrets from the May 2026 Graph
webhook work — correct app, correct permissions, never used. The code reads the
`MS_*` names with `GRAPH_*` accepted as an alias.

Azure permissions were already correct and needed no change:
`Sites.ReadWrite.All` + `Files.ReadWrite.All`, **Application** type, admin
consent granted for Pyramid Restoration.

## VERIFIED
- `graph_health` → `{ok: true, mode: 'app_only', client_id: 'ac2882ee-…'}`
- P-0011 created: `sharepoint_created: true`, `sharepoint_warning: null`,
  35 subfolders, 36 tasks seeded.
- **Tell-tale:** SharePoint "Modified By" on P-0011 reads **"SharePoint App"**,
  not the signed-in user. Every prior folder was created as `app`. That column is
  the fastest way to confirm app-only auth is actually in the path.

## KEY LEARNINGS
- **Supabase `provider_token` is not a durable credential.** It is a one-shot
  capture at login with no refresh. Anything server-side and long-lived must use
  app-only client credentials, not a borrowed user token.
- **A capability that only works right after login will pass every test you
  run.** You always test just after signing in. Long-duration behaviour has to be
  tested deliberately or it never gets tested at all.
- **Never `if (token) { ... }` with no else on a side effect.** The silent skip
  cost more than the token bug — it turned a clear failure into a mystery that
  surfaced days later somewhere unrelated.
- **Check what is already configured before adding anything.** The credentials
  had been sitting unused in Supabase secrets for two months. A new client secret
  was nearly generated for no reason.
- **DB commit first, SharePoint second.** A row without folders is recoverable.
  A folder without a row is an orphan nobody knows exists.

## HAND-OFF / REMAINING
- **Long-duration test (do this):** leave a tab open 2+ hours, create a project,
  confirm folders appear. That is the condition that failed before; everything
  else can pass while still being broken.
- **Frontend, ships with Deploy B:**
  - Health banner on New Project / New Client using `graph_health` — non-blocking,
    warns before the user does the work.
  - "Create folders" button wired to `backfill_project` wherever
    `sharepoint_folder_id` is null. Extend to clients and sites.
  - Admin view listing all unprovisioned records.
- **Orphans:** P-0007 through P-0010 have no folders. They are demo data and are
  covered by the pre-import purge (`PURGE_demo_projects_v2.sql`).
- **Unblocked by this fix:** the S: drive file-server migration, which required
  app-only Graph auth and had been blocked on it.
- **Secret expiry:** `MS_CLIENT_SECRET` was created 2026-05-22. Confirm its
  expiry date and set a calendar reminder 2 months ahead of it. An expired Graph
  secret fails silently and takes all SharePoint functionality with it.

**Files touched:** `supabase/functions/project-proxy/index.ts` (single file;
edge function deploy only, no git push, JWT verification stays OFF).
