# SOLVED — Stage control Phase 1: DB-driven stage model, decoupled from status

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**DB:** Supabase `izjaxmcdlsdkdliqjlei` (PYRAMID CLIENT COMMAND)
**Module:** Project workflow — `projects.current_stage`, stage triggers, `stages` table
**Date:** 2026-08-08
**Status:** DB half APPLIED & VERIFIED in production. Frontend = next (still Phase 1).
**Migration:** `supabase/migrations/10_stage_control.sql` (supersedes `09_award_gate_and_promote.sql`)

---

## PROBLEM
The stage model was broken and ambiguous:
- `status` drove `current_stage` through `sync_stage_from_status`, whose CASE only
  reached stages 1, 2, 3, 5, 6 — `Job Closed` mapped to **6, not 10**, and stages
  4/7/8/9/10 were unreachable by any status.
- Stage labels were **hardcoded in the frontend** (`ProjectList.jsx`, a 6-entry map)
  that didn't even match the 10-stage demo shown to Jorge.
- No admin control to move a project forward or back through stages.
- The award gate + prospect→client promote (migration 09) keyed off **status
  strings** — but the real advance path is status-driven via a BEFORE trigger, and
  `on_stage_advance` (AFTER UPDATE OF current_stage) never fired on that path, so
  the gate/promote were on the wrong axis.

## ROOT DECISIONS (locked with Bill)
- **Two axes, kept separate.** `current_stage` (smallint, 1..N) = workflow position,
  admin-driven. `status` (enum `project_status`) = business/outcome label,
  independent. Outcomes like *No Bid* / *Bid Not Awarded* live only in `status`.
- **Ship the live 6-stage model now**, structured so expanding to 10 later is pure
  data. (The live app already ran 6 stages; the 10 were demo-only.)
- **Advance one stage at a time** in normal use; admin **override** may jump, and a
  forward jump must not skip task provisioning.
- **Retreat leaves completed tasks as-is** (idempotent provisioning guarantees it).
- **N/A** for unneeded tasks instead of lingering (already supported — see below).

## FIX — `10_stage_control.sql`
1. **`public.stages` label table** (6 rows: Bidding/Interview/Awarded/Transfer/
   Active/Closeout). Labels editable in-DB, renamable/extendable with no deploy.
   RLS: authenticated read, writes proxy-only.
2. **Decoupled the axes.** Dropped the `sync_stage_on_status` trigger, so changing
   status no longer moves the stage bar (and vice versa). Set `current_stage`
   default = 1 and backfilled nulls so new projects still start sane.
3. **Loop-provision.** Rewrote `handle_stage_advance` to `provision_stage_tasks`
   for **every** stage `1 .. NEW.current_stage`, so an admin override jump fills any
   skipped stages. `provision_stage_tasks` is idempotent (skips templates that
   already have a task), so retreat is a harmless no-op and nothing duplicates.
4. **Superseded migration 09.** Dropped the status-keyed gate/promote; recreated
   both keyed to `current_stage >= 3`:
   - `enforce_award_requirements` (BEFORE INSERT/UPDATE OF current_stage) — blocks
     reaching Stage 3+ without `client_id` + `site_id`.
   - `auto_promote_client_on_award` (AFTER INSERT/UPDATE OF current_stage) — flips
     the client `prospect → client`, idempotent.

## VERIFIED (2026-08-08, self-rollback test)
```
gate(want t): t   promote(want client): client   tasks_1to3(want >0): 15
```
15 = 7 (stage 1) + 3 (stage 2) + 5 (stage 3) templates. Gate blocks award without
site; promote flips the prospect; loop-provision seeds stages 1–3 on reaching 3.

## KEY LEARNINGS
- **PL/pgSQL `FOR s IN 1..n` loop var is ALWAYS `integer`**, regardless of how it's
  declared. `provision_stage_tasks` takes `(uuid, smallint)`; passing the loop var
  raw resolves to `(uuid, integer)` which doesn't exist (`integer` won't implicitly
  down-cast). Fix: cast at the call — `provision_stage_tasks(NEW.id, s::smallint)`.
  Confirm real signatures with `pg_get_function_identity_arguments(oid)` — don't
  assume the type (this bit us twice before we read it).
- **`UPDATE OF <col>` fires on the statement's SET list, not on BEFORE-trigger
  changes** — the original reason the award logic had to move off the status path.
- **`na` / `skipped` are already valid `task_status` values** (`{pending,
  in_progress,completed,overdue,skipped,na}`) — the N/A control is UI-only, no
  schema change.
- **Applying DDL ≠ verifying behavior.** The `create`/`create trigger` blocks
  return "Success, no rows" even when a called function's signature is wrong —
  only the uncommented rollback test surfaced it.

## HAND-OFF / REMAINING
- **IRA Stage 4 gap (Pyramid decision):** Stage 4 *task templates* are
  `division='regular'` only, but the Stage 4 *milestones* apply to IRA — so a rope
  job is told to track COI/permits as milestones with no tasks to do them.
  Loop-provision can't fix this (nothing to provision for IRA at Stage 4). Confirm
  with Gabriel whether IRA runs the same permits/insurance flow:
  - same → `update workflow_task_templates set division = null where stage_number = 4;`
  - different → seed a tailored IRA Stage 4 template set.
- **Frontend (Phase 1, next):**
  - `ProjectDetail.jsx` — Advance/Back buttons + admin "Set stage…" override with a
    confirm modal; wire the stage bar to read the `stages` table (not the hardcoded map).
  - Per-task **Complete / N/A / Reopen** control (writes `na` via `update_task`).
  - `ProjectList.jsx` — swap hardcoded `STAGE_LABELS` for the `stages` table so both
    pages share one source.
- **Phase 2 (after Aug 21 cutover):** archive lifecycle `active → pending_archive →
  archived` with a **30/60/90-day** reversible window (default 60), reopenable on
  human error. NOT stages 11/12 — a separate records-management field so
  "Stage N of 6" stays meaningful.
- **Stage relabeling** to the demo wording (Pre-Con / Mobilize / Production / …) is a
  data edit on `stages` whenever Jorge settles it.

**Files touched:** `supabase/migrations/10_stage_control.sql`.
