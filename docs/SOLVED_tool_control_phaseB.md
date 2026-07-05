# SOLVED — Tool Control Phase B: Supabase wiring, multi-device fixes, photos

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**Module:** Tool Control (`/tools`)
**Date:** 2026-07-05
**Status:** Shipped to production (test data). Migrations run, Edge Function deployed, frontend pushed.

---

## PROBLEM
Tool Control shipped in Phase A as a phone-first scan → check-out/in UI backed by
in-memory demo data — nothing persisted. Phase B had to make it real: catalog +
history in Supabase, "who has it" from real staff, photos for condition
documentation, and durable QR tags. During rollout three production bugs surfaced.

## FIX — WHAT SHIPPED
**Core wiring**
- Migration `05_tool_control.sql`: `tools` catalog (denormalized current holder/job
  + status) and `tool_transactions` append-only ledger (out/in/maintenance/enrolled/
  retired, each `created_at`-stamped — the source of truth for history). Added
  `tool_manager` to the `user_role` enum. RLS: authenticated SELECT; all writes via proxy.
- `project-proxy` extended with six tool actions (enroll / checkout / checkin /
  maintenance / retire / update), reusing the existing `lookupCallerProfile` + admin
  pattern. enroll/update/retire gated to `admin || tool_manager`.
- `ToolControl.jsx` swapped demo seeds for live reads (tools + ledger + profiles +
  projects); writes route through the proxy with the Azure-AD token from localStorage.

**Three production bugs fixed**
1. **Multi-device asset-ID collision (critical).** Asset IDs were generated
   client-side from the tool list each device saw. Two devices both saw an empty
   list, both generated `PYR-0001`, and the second insert 400'd on the unique
   constraint. Moved ID generation **server-side** in the proxy: derive next number
   from the current max `PYR-####`, and on a unique clash bump + retry. Two
   simultaneous enrolls now get `PYR-0001` / `PYR-0002`, never collide.
2. **Replacement value saved as $0.** `Number("$650")` is `NaN` → 0. Now strip
   `$`/commas before converting.
3. **Infinite loading hang.** The post-write reload fired four concurrent authenticated
   reads; when one stalled on the auth refresh-race, `Promise.all` never resolved →
   dead spinner, and enroll froze because it awaited the reload. Fixed by (a) showing
   the tag the instant the write returns and refreshing in the background, and
   (b) time-boxing the reads (12s) with a Retry fallback instead of an endless spinner.

**Photos**
- Migration `06_tool_photos.sql`: `photo_urls jsonb` on `tools` (enrollment reference
  photos) and `tool_transactions` (per-action condition photos). Additive.
- Up to 2 photos on enroll, checkout, and check-in. All upload to SharePoint
  `Tools/{asset_id}/`, named by action (`-enroll-`, `-out-`, `-in-`). Enrollment
  photos surface as clickable tiles on the tool sheet.

**Tags**
- QR tag print reworked to print centered/complete on a normal Letter printer while
  still filling a 2.2×1.1 Godex label. ECC level H (30%). QR encodes the asset ID only.

## KEY LEARNINGS
- **Never generate shared IDs client-side.** Any ID that must be unique across users
  or devices has to be allocated in one place (server) with a retry on clash — a
  client can't see what another client just wrote.
- **Decouple user-visible success from background refresh.** A write shouldn't await a
  reload to show its result; if the reload can hang, the whole action hangs with it.
- **Time-box every concurrent authed read.** With the known auth refresh-race present,
  an unbounded `Promise.all` is a latent dead-spinner. A timeout + Retry is the failsafe.
- The intermittent stall itself is the open Web-Lock-bypass auth bug — still awaiting the
  30-second DevTools capture; NOT touched here.
- `project-proxy` spreads `{...tool}` / `{...updates}`, so new columns need no
  edge-function change to read/write. Graph path-upload auto-creates `Tools/{asset_id}/`.

## HAND-OFF / REMAINING
- **Phase B.1 — usage/utilization report:** times-used, days-in-field, utilization %,
  top users/jobs, overdue-by-duration. Pure read over `tool_transactions`; no schema change.
- **Inline photo previews:** sheet tiles link to SharePoint (URLs need auth). Inline
  thumbnails would need a Graph fetch — deferred.
- **Delete/edit tool from the sheet:** currently done in Supabase Table Editor; a gated
  `delete_tool`/edit control is a small add if wanted.
- **`tool_manager` rollout:** assign to the tool-crib manager (+ admins) when ready.
- **Files:** `supabase/migrations/05_tool_control.sql`, `06_tool_photos.sql`;
  `supabase/functions/project-proxy/index.ts`; `src/pages/ToolControl.jsx`.
