# RECAP — Pyramid Portal, Deploy A + Deploy B complete

**Date:** 2026-08-08
**Repo:** `pyramidny/PYRAMIDNY` @ `9e37eaa` — clean, synced to production
**Working clone:** `C:\Intel\PyramidAPP\PYRAMID-FRESH` (Documents clone is stale — do not use)
**Supabase:** `izjaxmcdlsdkdliqjlei` (PYRAMID CLIENT COMMAND)

---

## WHAT SHIPPED THIS SESSION

### Deploy A — app-only Microsoft Graph auth
Full write-up in `docs/SOLVED_app_only_graph_auth.md`.

Every SharePoint call ran on Supabase's `provider_token` — captured once at
OAuth login, never refreshed, ~1 hour lifetime. The whole SharePoint layer only
worked for about an hour after a fresh sign-in. Folder creation also failed
**silently** (`if (providerToken)` with no else), so projects saved with no
folders and no warning.

Replaced with client-credentials auth against PYRAMID COMMAND CENTER
(`ac2882ee-091b-4fcf-bb83-5e242d41b6a7`), cached in `graph_token_cache`.
Credentials were already in Supabase secrets as `MS_TENANT_ID` / `MS_CLIENT_ID`
/ `MS_CLIENT_SECRET` from the May webhook work — no new secret needed.

Verified: `graph_health` returns `ok: true, mode: app_only`. SharePoint
"Modified By" reads **"SharePoint App"** — fastest confirmation app-only auth is
in the path.

**Secret expires ~May 2027. Set a calendar reminder for March 2027.**

### Migrations 07 + 08 — client hierarchy
Both applied and verified.

- `clients` — name, `client_type`, `relationship_status` (prospect | client),
  `parent_client_id`, address, `qb_customer_name`, SharePoint IDs
- `sites` — `client_id` FK (**reassignable**), name, address, borough, BIN,
  phone/email/website/management_office, SharePoint IDs
- `contacts` — client + optional primary site, `contact_type`,
  `is_billing_contact`, `is_portal_user`, `legacy_notes`
- `site_contacts` — **many-to-many**; one super/PM covers several buildings
- `project_contacts` — many-to-many
- `projects` additive: `client_id`, `site_id`, `qb_customer_job`,
  `archive_folder_id`, `archive_folder_url`
- Enums: `client_type`, `contact_type`, `relationship_status`
- RLS: authenticated SELECT, all writes proxy-only

### Deploy B — client/site/contact UI + backend
- `project-proxy` (now ~1716 lines): `client_create/update/delete/promote`,
  `site_create/update/delete`, `move_site`, `contact_create/update/delete`,
  `site_contact_add/remove`, `project_contact_add/remove`, `backfill_folders`
- New pages: `ClientList.jsx`, `ClientDetail.jsx`, `SiteDetail.jsx`
- New module: `lib/clientsApi.js`
- `NewProject.jsx` — Client & Job Site pickers (site list filters to client)
- `ProjectDetail.jsx` — Client & Job Site card linking back up the tree
- `Sidebar.jsx` — Clients entry under MANAGE, **not** adminOnly
- `permissions.js` — client/site perms + `useCanDo` memoised

### Two bugs found and fixed during rollout
1. **Infinite render loop.** `useCanDo()` returned a fresh arrow every render;
   putting it in a `useCallback` dep array in SiteDetail caused ~31,000 requests
   until `ERR_INSUFFICIENT_RESOURCES`. Fixed by memoising `useCanDo` on `role`
   and depending on the plain `isAdmin` boolean.
2. **Invisible text.** The content area of this app is LIGHT (`bg-white`,
   `text-gray-900`) — only the sidebar shell is dark. The three new pages were
   built with the dark `ink-*` palette, so names rendered near-white on white.
   Same class of bug as `SOLVED_dropdown_contrast.md`.

---

## LOCKED DECISIONS

| Decision | Answer |
|---|---|
| Client | The entity Pyramid **bills**. Matches QuickBooks. One per project. |
| Contact | Anyone else involved — architect, engineer, board, super. |
| Hierarchy | Client → Site → Project. Sites reassignable between clients. |
| Prospect vs Client | Separate axis from `client_type`. New companies start as prospect, promote on first won bid. |
| Files | Attach at project level. |
| SharePoint | Client / Site / Project nesting. Address by driveItem ID, **never** path. |
| Name caps | Client 28 / Site 28 / Project `P#####_slug`. Strip punctuation. |
| Stages | **10**: Bid, Interview, Award, Pre-Con, Mobilize, Production, Final Pay, Closeout, Retainage, Closed. Labels in DB. |
| Client on New Project | Optional at bid; required at Stage 3 (Awarded). |
| Clients nav | Own sidebar entry under MANAGE, not adminOnly. |
| Client portal access | All-or-none per project. Gate lives in ONE function. |
| Legacy files | Separate `/sites/Archives/` site, year folders, structure preserved as-is. |
| Numbering cutover | **Friday, August 21, 2026.** |

---

## STILL OPEN — the Aug 21 cutover

### 1. `generate_project_number` rewrite — BLOCKING
Current version:
```sql
SELECT COALESCE(MAX(CAST(SUBSTRING(project_number FROM 3) AS INT)), 0) + 1
```
`SUBSTRING('P11375' FROM 3)` returns `375`. The moment legacy numbers land it
starts minting collisions. Must move to `P#####` / `A#####` format and seed the
sequence above the server's current max (~P11460). Driven by the
`set_project_number` BEFORE INSERT trigger on `projects`.

### 2. Purge
`PURGE_demo_projects_v2.sql` — staged, tested against the real FK list
(10 FKs; note `tools.current_project_id`, not `project_id`). Run immediately
before import.

### 3. Import
`Pyramid_Import_Preview.xlsx` has the full decomposition:
- **153 clients → 335 sites → 482 projects**, zero orphans
- Confidence: 48 high / 371 medium / **63 needs review** (no delimiter in the
  QB job name, so site vs scope can't be inferred — own tab in the workbook)
- Contact sheet: 79 firms → 10 exact QB matches, 11 probable, **58 no match**
  (architects/engineers — not in QuickBooks, import as **prospect**)
- Day-one client list is ~211 companies, not 153

**Send the 63-row review list to Pyramid NOW**, not on cutover day. It's the
only part of the import that needs a human.

### 4. Not yet wired
- **Prospect → client auto-promote at Stage 3.** A `client_promote` action and
  a manual button exist. Wiring it into `handle_stage_advance` needs the current
  function body first: `select prosrc from pg_proc where proname='handle_stage_advance';`
- **Stage 3 gate** requiring client + site — same place, same reason.

---

## FILE MIGRATION

- **Archive migration is running** — SPMT from the file server to
  `/sites/Archives/`, ~410 inactive folders, year folders, structure untouched.
- **Active ~40 jobs:** PowerShell generates an SPMT **bulk CSV**, one row per
  legacy subfolder mapped to its new location, so they land in the correct
  structure automatically. **Needs the folder mapping table** (Jorge item).
  Depends on Deploy B, which is now done.
- **Index pass:** after SPMT finishes, PowerShell walks the Archives top-level
  folders, pulls the `P#####` prefix, emits CSV of driveItem IDs + URLs →
  `projects.archive_folder_url`. Cheap now, expensive to reconstruct later.
- Legacy folder mapping decision: **archive as-is, no remapping.** Only the ~40
  active jobs get remapped into the new structure.

---

## STILL WITH PYRAMID

1. Stage 7–10 label wording (proposed: Final Payment / Closeout / Retainage /
   Closed). Low stakes — renaming is a DB edit.
2. Whether all-or-none client portal access is sufficient.
3. **Folder mapping table** for the ~40 active jobs — now the gating item for
   the active-job SPMT CSV.
4. The 63-row import review list.
5. **Operational notice, not a question:** after **August 21** all new job
   numbers come from the portal. Nobody creates numbered folders on the server
   by hand after that date.

---

## CRITICAL CONSTRAINTS — carry these forward

- **Azure AD auth is immutable.** `supabase.auth.getSession()/getUser()` return
  null for Azure AD tokens. Read from
  `localStorage['sb-izjaxmcdlsdkdliqjlei-auth-token']`. Use `profile.id`. Edge
  functions deploy with JWT verification OFF. This is correct by design.
- **All writes go through `project-proxy`** on the service_role key.
- **Every dashboard edge-function deploy needs a matching commit**, or the repo
  drifts. This bit us twice this session — once a SQL file got saved over
  `project-proxy/index.ts` and would have replaced a 21-action edge function
  with a migration script.
- **Address SharePoint by driveItem ID, never path.** Paths break on rename and
  make `move_site` impossible.
- **DB commits first, SharePoint second.** A row without folders is
  recoverable; a folder without a row is an orphan.
- **`qb_customer_job` is never rewritten**, even when a site moves clients.
- **Site names are unique per client, not globally.**
- **The content area is LIGHT.** Only the sidebar is dark. Any `ink-*` text
  class on a white card is invisible.
- **Hooks returning functions are unsafe in dependency arrays.** `useCanDo` is
  now memoised; watch for others.
- **Supabase MCP `execute_sql` is permission-denied** on this project — schema
  work runs manually in the SQL Editor.

---

## DEFERRED / LATER

- Permits, Insurance (client + project level), Billing queue, A/R — all seen in
  the approval demo at `gc.kanepc.com/demo.html`, none schema'd yet.
- QuickBooks link state behind "Mark Created in QuickBooks" (`qb_linked_at`).
- Skill extraction: `@kanepc/sharepoint-migration` — app-only Graph auth,
  folder provisioning, SPMT CSV generation, index pass. **Extract AFTER the
  Pyramid migration proves out**, same as Tool Control v0.1.0.
- Tool Control Phase B.1 — utilisation report, pure reads.
- `billing.html` / `joblife.html` in repo root behind app auth — move to
  `public/` or delete.
- Remove temp `with check (true)` RLS on `projects_insert` at go-live.
- Drop `property_manager_owner` / `architect_engineer` once clients and
  contacts hold real data (still on the New Project form, duplicated).
- Webhook live-sync (`graph_subscriptions`, `webhook_events` exist, 0 rows).
