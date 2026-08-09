# RECAP — start-here for next session

**App:** Pyramid Restoration Staff Portal (`app.pyramidny.com`)
**DB:** Supabase `izjaxmcdlsdkdliqjlei` (PYRAMID CLIENT COMMAND) · **Repo:** `pyramidny/PYRAMIDNY`, main · **Clone:** `C:\Intel\PyramidAPP\PYRAMID-FRESH`
**Date:** 2026-08-09

## DONE & VERIFIED THIS SESSION
- **Stage control Phase 1 frontend** — shipped: 6-segment stage bar (reads `stages` table), admin Advance/Back/Set-stage with confirm modal, per-task Complete/N/A/Reopen, ProjectList reads `stages`. (`\uXXXX` glyph gotcha fixed — write real characters in JSX, never `\u` escapes.)
- **Migration 11 — `generate_project_number` rewrite** — applied & verified. `P#####`/`A#####`, no dash, floor `P11700`/`A11400`. See `SOLVED_generate_project_number.md`.
- **`PURGE_full_v3.sql`** — full-hierarchy reset (projects + clients/sites/contacts; keeps profiles/whitelist/tools). This is the undo button. NOTE: Supabase SQL Editor rolls back a `begin` block that lacks `commit;` in the same run — include `commit;`.
- **`import_pilot.sql`** — loaded 152 clients / 335 sites / 482 projects (54 Active / 428 Closed), DB-only, idempotent. See `SOLVED_idempotent_import.md`.
- **`backfill_numbers_v2.sql`** — 109 real legacy numbers (72 regular + 37 IRA) + folder links; 0 collisions. See `SOLVED_folder_reconciliation.md`.
- **ProjectDetail archive link** — shipped (commit `6c8908b`): "Open archive folder ↗" (SharePoint URL) or file path when only `imported_from_path`.

## CURRENT STATE
Pilot-ready. 152/335/482 in the DB, correct numbering, 109 real numbers reconciled and linked, `reconciliation_review.html` + `match_review_v2.xlsx` for the remaining 373. Testing guide drafted for Pyramid.

## OPEN / NEXT
1. **Reconciliation follow-through** — staff resolve **174 pick-one** + **73 contended** in the report/worksheet → send picks back → I generate a **second UPDATE**. The **126 no-folder** likely have no folder on file (stay on minted number).
2. **A-series URLs** — the 37 IRA matches carry a file path (`imported_from_path`), not a clickable link. Run PnP `-UseWebLogin` against the **Access** SharePoint site, export A-series folder name+URL, and backfill `archive_folder_url` (so the archive button is clickable for IRA too).
3. **Pilot** — designated testers, ~5-10 jobs, gather feedback; treat data as disposable (one reset possible via `PURGE_full_v3.sql`).
4. **Send Pyramid the 63 "Needs Review" import rows** (separate sheet in `Pyramid_Import_Preview.xlsx`) — jobs whose `Customer:Job` had no delimiter, need a site decision.
5. **Folder provisioning** — Clients page "Create folders" provisions client/site folders for the **active set** only; do NOT bulk-provision all 152/335 (the single-call backfill would time out — needs batching before a full provision).

## DEFERRED (post-cutover)
- **Deploy C** — permits + insurance tables (the COI/CCI/DOB/DOT milestones + the demo's cert cards). Includes **milestone doc-attach** and **milestone reminder date**.
- **Reskin** — start with theme-agnostic wins (breadcrumbs, stat cards, badges) on the current light theme; full dark theme + light/dark toggle is its own later pass (content area is light; ink-on-white contrast has bitten before).
- **In-app reconciliation UI** — the "point at an SP site, match by address, assign owner, orphan bucket" tool; the HTML report is its first useful form.
- **`friendly_name` column** on projects (number = identity, friendly_name = human label). Additive; proxy passes new columns through.

## STANDING RULES / GOTCHAS (carry forward)
- SQL runs in the **Supabase SQL Editor**, not PowerShell; `git push` deploys frontend to Netlify only — never SQL.
- Azure AD tokens: read from `localStorage['sb-izjaxmcdlsdkdliqjlei-auth-token']`, use `profile.id`; Edge Functions `--no-verify-jwt`.
- `useCanDo()`'s function must never sit in a dependency array — depend on the stable `isAdmin` boolean.
- The connected **Microsoft 365 MCP is the Kane PC tenant** and cannot read Pyramid's SharePoint (separate tenant, guest access; Graph search doesn't cross tenants).
- **Re-verify the server number max on cutover lock day**; bump the migration-11 floor if the P-series crosses 11700.

## KEY FILES THIS SESSION
`supabase/migrations/11_generate_project_number.sql` · `PURGE_full_v3.sql` · `import_pilot.sql` · `backfill_numbers_v2.sql` · `reconciliation_review.html` · `match_review_v2.xlsx` · `src/pages/ProjectDetail.jsx` (archive link) · `Pyramid_Import_Preview.xlsx` · the three `SOLVED_*.md` above.
