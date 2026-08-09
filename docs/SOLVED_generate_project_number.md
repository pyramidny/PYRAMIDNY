# SOLVED — generate_project_number rewrite (cutover numbering)

**Date:** 2026-08-09 · **Migration:** `11_generate_project_number.sql` · **Status:** APPLIED & VERIFIED (returns `P11700` / `A11400` on a clean DB)

## Problem
The live `generate_project_number()` did `SUBSTRING(project_number FROM 3)` and emitted `prefix || '-' || LPAD(seq,4,'0')`. That:
- stripped **two** characters (`P1`), not one — so legacy `P11637` parsed as `1637`;
- produced the demo format `P-1637` (dash, 4-pad), not the real folder format `P#####`;
- would mint **colliding** numbers the moment legacy `P#####` data landed.

First rewrite also broke: parameter was declared `text`, but `projects.division` is the enum `division_type`. That created a *second* overload instead of replacing the real function, and `where division = p_division` failed with `operator does not exist: division_type = text`.

## Fix
Rewrote `generate_project_number(p_division division_type)` (matching the original signature so `create or replace` replaces the function the trigger calls):
- parse the **full first digit run** with `(regexp_match(project_number,'[0-9]+'))[1]::int` — dash-agnostic; `P11637`, `P-0013`, `P11700` all parse the same;
- emit `P#####` / `A#####` (5 digits, **no dash**) to match the server folder naming;
- clamp to a per-division **floor**: `next := greatest(max(existing)+1, floor)` where `floor = 11700` (regular / P) and `11400` (IRA / A).

The `auto_project_number()` BEFORE-INSERT trigger was left unchanged — it only generates when `project_number` is blank, so imported rows that carry a real number keep it.

## Key learning
- **Verify against reality, not the recap.** The recap said the server max was ~`P11460`; the actual bid folders were at `P11637` and climbing ~30/month. Trusting the stale number would have collided with ~180 existing folders.
- **`projects.division` is an enum (`division_type`).** `create or replace` with a mismatched param type silently creates a second overload and the enum `=` text comparison has no operator. Always match the exact signature (name **and** arg types).
- **The floor must sit above the *server* max, not just the DB max.** Un-awarded bid folders exist on the server but never reach QuickBooks, so they aren't imported — DB max can be *lower* than server max, and a naive `max+1` would collide with a real folder. The floor jumps over them.
- **Re-verify the server max on lock day** and bump the floor if the P-series crosses 11700 before go-live (it's just a `create or replace`).

## Hand-off
Applied and verified. New app-minted jobs start at `P11700` / `A11400`; all legacy/imported numbers sit below the floor, collision-free.
