# SOLVED — idempotent QuickBooks import (pilot load)

**Date:** 2026-08-09 · **File:** `import_pilot.sql` · **Status:** APPLIED — DB holds 152 clients / 335 sites / 482 projects (54 Active / 428 Closed)

## Problem
Load the QuickBooks export (153 clients / 335 sites / 482 projects) into the portal so a supervised pilot could run, with these constraints: **DB-only** (no SharePoint folders), **re-runnable** without duplicating or clobbering tester edits, status derived from data, and numbers respecting the new floor.

## Fix
One self-contained SQL file, generated from the workbook:
- builds `stg_clients` / `stg_sites` / `stg_projects` temp tables + generated `INSERT`s (no CSV-import dance);
- creates natural-key unique indexes and **upserts** in FK order — clients (`qb_customer_name`) → sites (`client_id,name`) → projects (`qb_customer_job`);
- **fill-null on conflict** — a re-run adds new/changed rows and never overwrites anything a tester edited;
- `status = balance > 0 ? 'Active Job' : 'Job Closed'` (54 / 428), `current_stage = 1` (decoupled from status);
- projects get **minted numbers ≥ floor** assigned *in the loader* (`base + row_number()` per division), so bulk insert doesn't collide.

Validated against a throwaway local Postgres (real column types + enums) **twice**: run 1 = 152/335/482; run 2 after editing a status and a phone = identical counts, edits preserved, 0 duplicate numbers.

## Key learning
- **QuickBooks has no P#####.** Jobs are keyed by `Customer:Job` name; the real numbers live on the SharePoint/file-server folders, not in QB. So the import key is `qb_customer_job` and numbers are minted (then reconciled separately).
- **Bulk `INSERT…SELECT` + a `max()`-based BEFORE trigger collides.** Every row in one statement sees the same pre-statement `max()`, so all get the same number. Fix: compute numbers in the loader (`base + row_number()` per division) and supply them explicitly; the trigger then keeps them.
- **Fill-null-only upsert = safe re-runs.** It's the difference between "sync" (top up new data) and "clobber" (wipe edits). `PURGE_full_v3.sql` remains the hard reset.
- **Test the loader against a local Postgres with the *real* column types before shipping.** A wrong enum cast or missing column on 970 rows is an expensive failure to hand a user (see the numbering-migration type bug).
- **1 duplicate `qb_customer_name`** in the source → 152 clients, not 153. Deduped in the upsert; expected, not a loss.

## Hand-off
Loaded and pilot-ready. Re-run to sync a fresh QB export; `PURGE_full_v3.sql` to start clean. Folders are provisioned separately (Clients page "Create folders" for the active set).
