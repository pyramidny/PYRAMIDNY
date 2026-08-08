# RECAP — Client Hierarchy Sprint (Deploy A shipped, Deploy B queued)

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**Date:** 2026-08-07
**Repo:** `pyramidny/PYRAMIDNY` @ `2e60707` — clean, synced to production
**Working clone:** `C:\Intel\PyramidAPP\PYRAMID-FRESH` (Documents clone archived)

---

## SHIPPED

### Deploy A — app-only Microsoft Graph auth
Full write-up in `SOLVED_app_only_graph_auth.md`. Summary:

- Every SharePoint call ran on Supabase's `provider_token`, which is captured
  once at login and never refreshed. Graph tokens live ~1 hour, so SharePoint
  only worked for about an hour after a fresh sign-in.
- Folder creation failed **silently** — bare `if (providerToken)` with no else.
  Projects saved with no folders and no warning.
- Fixed with client-credentials auth against PYRAMID COMMAND CENTER
  (`ac2882ee-091b-4fcf-bb83-5e242d41b6a7`), cached in `graph_token_cache`.
- Credentials were already in Supabase secrets as `MS_TENANT_ID` /
  `MS_CLIENT_ID` / `MS_CLIENT_SECRET` from the May webhook work. No new secret
  was needed. **Expires ~May 2027 — set a reminder for March 2027.**
- Verified: `graph_health` returns `ok: true, mode: app_only`. P-0011 created
  with 35 subfolders. SharePoint "Modified By" reads **"SharePoint App"**, which
  is the fastest confirmation that app-only auth is in the path.

### Migration 07 — client hierarchy
`supabase/migrations/07_client_hierarchy.sql`, applied 2026-08-05, verified 4/5/2.

- `clients` — name, `client_type`, `parent_client_id` (self-ref), address,
  `qb_customer_name`, SharePoint IDs
- `sites` — `client_id` FK (**reassignable** — this is how a building changes
  management company), name, address, borough, BIN, SharePoint IDs
- `contacts` — client + optional site, `contact_type`, `is_portal_user`,
  `legacy_notes`
- `project_contacts` — many-to-many, keeps the tree clean while letting an
  architect at another firm attach to a job
- `projects` additive: `client_id`, `site_id`, `qb_customer_job`,
  `archive_folder_id`, `archive_folder_url`
- New enums `client_type`, `contact_type`. RLS: authenticated read, writes
  proxy-only.

---

## LOCKED DECISIONS

| Decision | Answer |
|---|---|
| Client | The entity Pyramid bills. Matches QuickBooks. One per project. |
| Contact | Anyone else involved — architect, engineer, board, super. |
| Hierarchy | Client → Site → Project. Sites belong to a client, reassignable. |
| Files | Attach at project level. |
| SharePoint folders | Client / Site / Project nesting. Address by driveItem ID, never path. |
| Name caps | Client 28 / Site 28 / Project `P#####_slug` 30. Strip punctuation. |
| Stages | 10. Labels move to DB so renaming needs no deploy. |
| Client portal access | All-or-none per project. Gate lives in ONE function. |
| Legacy files | Separate `/sites/Archives/` site, year folders, structure preserved as-is. No remapping. |
| Closed projects | Stay in place. Filtered in the app, not moved. |
| Numbering cutover | **Friday, August 21, 2026.** |

---

## BLOCKING DEPLOY B — 2 answers needed

1. **Clients in the sidebar, or under Settings?**
   Recommendation: own sidebar entry under MANAGE, alongside Team and Tool
   Control, and **not** `adminOnly` — estimating and PMs will use it daily.

2. **Client + site required on New Project, or optional?**
   Recommendation: optional at bid, **required at Stage 3 (Bid Awarded)**. Bids
   arrive before the billing entity is known; forcing it produces junk records.
   Stage 3 is where contract and billing handoff already happen.

Both change routing and form validation, so getting them wrong means editing
the same files twice.

---

## DEPLOY B — BUILD LIST

### 1. `supabase/functions/project-proxy/index.ts`
- `client_create` / `client_update` / `client_delete` (soft, `is_active`)
- `site_create` / `site_update` / `site_delete`
- `contact_create` / `contact_update` / `contact_delete`
- `project_contact_add` / `project_contact_remove`
- **`move_site`** — update `sites.client_id` + Graph PATCH on the folder's
  `parentReference`. Server-side move, instant, IDs and history intact.
- **`resurrect_project`** — status off closed + Graph move the archive folder
  back under the project as `4. Legacy Files`. Reversible.
- `backfill_folders` — extend existing `backfill_project` to clients and sites;
  provisions anything where `sharepoint_folder_id IS NULL`
- Admin-gated via existing `lookupCallerProfile` pattern

### 2. SharePoint tree changes (backend + frontend together — see note)
- Add `4. Client Facing` as a fourth top-level parent
- Add `Receipts` under `2. Production`
- Abbreviate the long subfolder names (URL-encoding makes spaces cost 3 chars
  each): `Bid Submission & Pricing Template` → `Bid Pricing`,
  `Specifications & Notice to Bidders` → `Specs & Notice`,
  `Field Reports & Meeting Minutes` → `Field Reports`,
  `Job Site Binder & Informational Packet` → `Job Site Binder`

### 3. Frontend
- `src/pages/ClientList.jsx` — search, type filter, parent/child grouping
- `src/pages/ClientDetail.jsx` — sites, contacts, projects roll-up, Move site
- `src/pages/SiteDetail.jsx` — projects at this site, contacts, Move to client
- Contacts management (within client detail)
- Client + site pickers on `NewProject.jsx`
- Stage 3 gate if that's the call
- **Health banner** on New Project / New Client via `graph_health` —
  non-blocking, warns before the user does the work
- **"Create folders" button** wherever `sharepoint_folder_id IS NULL`
- Drag-and-drop upload per document section (drag from Explorer, not from the
  SharePoint browser view — dragging within SharePoint means download-then-reupload)
- `Sidebar.jsx` + `App.jsx` routing
- `src/lib/permissions.js` + backend mirror in `project-proxy`

### 4. Import (Aug 21, same session as cutover)
- Rewrite `generate_project_number` — current version does
  `SUBSTRING(project_number FROM 3)`, which returns `375` for `P11375` and will
  mint colliding numbers the moment legacy data lands. **Blocking.**
- Seed the sequence above the server's current max (~P11460)
- Run `PURGE_demo_projects_v2.sql`
- Import 153 clients + ~334 sites from the QuickBooks export
- Import 318 contacts from the hand-maintained sheet, matched against clients
- CSV mapping + preview screen: match / new / conflict flags, commit on approval

---

## CRITICAL CONSTRAINTS

- **Backend folder tree and frontend category lists must ship together.** Graph
  PUT-by-path auto-creates missing parents, so a backend-only change regenerates
  the old structure on the first upload. This has bitten before (June 19).
- **Address SharePoint by driveItem ID, never path.** Paths break on rename and
  make `move_site` impossible.
- **DB commits first, SharePoint second.** A row without folders is recoverable;
  a folder without a row is an orphan nobody knows exists.
- **`qb_customer_job` is never rewritten**, even when a site moves to a new
  client. Invoices raised under the old agent stay keyed to the old agent.
- **Site names are unique per client, not globally.** 98-01 67th Avenue exists
  under both Realty Operation Group and Kings & Queens.
- **Never generate shared IDs client-side** (Tool Control Phase B lesson).
- **Every dashboard edge-function deploy needs a matching commit**, or the repo
  drifts from production. This bit us within an hour on 2026-08-07 — a SQL file
  got saved over `project-proxy/index.ts` and would have replaced a 21-action
  edge function with a migration script.

---

## OPEN / LATER

- **Long-duration test:** leave a tab open 2+ hours, create a project, confirm
  folders appear. This is the condition that failed before app-only auth.
- **Archive index pass:** after SPMT finishes, PowerShell walks the top-level
  Archives folders, pulls the `P#####` prefix from each name, and emits a CSV of
  driveItem IDs + URLs → `projects.archive_folder_url`. Folder-level only; file
  level is unnecessary. Cheap now, expensive to reconstruct later.
- **Active-job SPMT CSV:** PowerShell generates one row per legacy subfolder
  mapped to its new location, so the ~40 active jobs land in the correct
  structure automatically. Needs the folder mapping table. Depends on Deploy B.
- **Skill extraction:** `@kanepc/sharepoint-migration` — app-only Graph auth,
  folder provisioning, SPMT CSV generation, index pass. Extract AFTER the Pyramid
  migration proves out, same as Tool Control v0.1.0.
- **Tool Control Phase B.1:** utilization report. Pure reads over
  `tool_transactions`, no schema change.
- **Cleanup:** `billing.html` / `joblife.html` sit in the repo root behind app
  auth — move to `public/` or delete.
- **Still deferred:** webhook live-sync (`graph_subscriptions` and
  `webhook_events` exist, 0 rows), remove temp `with check (true)` RLS on
  `projects_insert` at go-live, drop `property_manager_owner` /
  `architect_engineer` once clients and contacts hold real data,
  `ToolControl.jsx` `alert()` → toast.

---

## STILL WITH PYRAMID

1. Stage 7–10 label wording (proposed: Final Payment / Closeout & Retainage /
   Retainage Released / Closed). Low stakes — renaming is a DB edit.
2. Whether all-or-none client portal access is sufficient.
3. **Operational notice, not a question:** after **August 21** all new job
   numbers come from the portal. Nobody creates numbered folders on the server
   by hand after that date. If this doesn't reach whoever does it today, the
   numbering collides on day one.
