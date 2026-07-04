# SOLVED — Tool Control Phase B (Supabase wiring)

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**Date:** 2026-07-04
**Status:** Shipped to production (test data only). Migration run, Edge Function deployed, frontend wired.

## PROBLEM
Tool Control shipped in Phase A as a phone-first scan → check-out/in UI backed by
in-memory demo data (`SEED_TOOLS` / `SEED_ACTIVITY` / `TECHS`). Nothing persisted:
no real tools, no history, no "who has it," no usage record.

## FIX — WHAT SHIPPED
- **Migration** `05_tool_control.sql` (run in SQL editor, additive):
  - `tools` catalog (denormalized `current_holder_id` / `current_project_id` + status).
  - `tool_transactions` append-only ledger (out / in / maintenance / enrolled / retired,
    each stamped `created_at`) — source of truth for history.
  - Added `tool_manager` value to the `user_role` enum.
  - `status` / `action` are text + CHECK (not enums) so states can grow with a one-line migration.
  - RLS: authenticated SELECT on both tables; all writes go through the proxy (service role).
- **`project-proxy/index.ts`** — six additive actions before the SELECT block:
  `enroll_tool`, `checkout_tool`, `checkin_tool`, `tool_maintenance`, `retire_tool`,
  `update_tool`. enroll/update/retire gated to `admin || tool_manager`; check-out/in/maint
  open to any active profile. Each write updates the ledger AND the denormalized `current_*`.
  Deployed `--no-verify-jwt`.
- **`src/pages/ToolControl.jsx`** — swapped demo seeds for live data:
  - Reads `tools` + `tool_transactions` + `profiles` (techs) + `projects` (jobs) via
    authenticated selects; adapts DB rows into the existing render shape (no UI rewrite).
  - Writes route through the proxy using the Azure-AD token from
    `localStorage['sb-…-auth-token']`; UI reloads after each write.
  - Check-in records the **scanner** (caller) as who returned it — no "who" dropdown.
  - Job site is now a **real project picker** (with a "No job / Tool Crib" option).
  - Checkout captures an optional **Expected return date** → drives real overdue.
  - **Damaged** on check-in auto-routes to maintenance.
  - Condition photo → SharePoint `Tools/{asset_id}/` (same site, Graph path-upload
    auto-creates the folder). Print/QR tag flow unchanged (ECC level H).

## KEY LEARNINGS
- `project-proxy` already carries the whole write pattern (`lookupCallerProfile`, admin
  checks, Graph upload) — extending it beat a new `tool-proxy`. No new function to maintain.
- Denormalized `current_*` gives fast list reads; the ledger keeps the permanent history.
  Usage counts ("used 47× over 1.5 yrs") = count of `out` rows in a window — no schema change.
- `git push` deploys only the frontend (Netlify). The Edge Function deploys separately
  (dashboard/CLI) — committing `project-proxy/index.ts` is repo housekeeping, not a redeploy.

## HAND-OFF / REMAINING
- **Phase B.1 — Usage/utilization report:** times-used, days-in-field, utilization %,
  top users/jobs, overdue-by-duration. Pure read over `tool_transactions`; no schema change.
- **`tool_manager` rollout:** assign the role to the tool-crib manager (+ admins) when ready.
- **Verify in prod:** enroll a tool, check out/in with a photo, confirm ledger + SharePoint
  `Tools/{asset_id}/` folder, confirm overdue flags on a past-due expected-return date.
- **Files touched:** `supabase/migrations/05_tool_control.sql`;
  `supabase/functions/project-proxy/index.ts`; `src/pages/ToolControl.jsx`.
