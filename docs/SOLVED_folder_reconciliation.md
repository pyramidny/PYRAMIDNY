# SOLVED — legacy job-number reconciliation (address matcher)

**Date:** 2026-08-09 · **Files:** `backfill_numbers_v2.sql`, `reconciliation_review.html`, `match_review_v2.xlsx` · **Status:** APPLIED — 109 real numbers backfilled (72 regular + 37 IRA), 0 collisions

## Problem
Imported jobs received minted `P11700+` / `A11400+` numbers, not their **real** legacy `P#####` / `A#####`. Staff know jobs by the real number, and those numbers live only in the **folder names** on SharePoint (OFFICE PROJECTS, P-series, with web URLs) and the file server (X:/Access, A-series, paths) — keyed by **address**, not by any QB field. Needed to backfill the real number + a link to the folder, **without** a purge/re-import.

## Fix
Address+scope fuzzy matcher (Python, validated against local Postgres):
- parse each folder name into `number + address + scope`;
- build an address key = **house number + street core**; match project→folder within the **same division**, disambiguate multi-candidate addresses by scope-token overlap, enforce **1:1** (a folder claimed by two jobs → review);
- confident matches → `UPDATE` setting `project_number` + `legacy_job_number` to the real number, and `archive_folder_url` (SharePoint URL) or `imported_from_path` (file path) to the folder;
- everything else → a **pick-one worksheet** (`match_review_v2.xlsx`) and a filterable **HTML report** (`reconciliation_review.html`).

Result: **109 confident** (72 P with URLs, 37 A with paths), all numbers `< 11700` floor, 0 duplicate numbers. 373 jobs to human review.

## Key learning
- **The mapping is many-to-many by address.** A facade contractor works the same buildings for years, so one address maps to several folders (different jobs/years). Only ~23% auto-match safely on address+scope; the rest genuinely need a human to pick. Auto-stamping there would risk the *wrong* number — worse than leaving it.
- **Real numbers are all below the floor**, so overwriting `project_number` with them is collision-safe by construction; new app jobs still mint `P11700+`.
- **Two folder sources, two link types.** P-series (OFFICE PROJECTS) came with SharePoint **URLs** → `archive_folder_url` (clickable). A-series (X:/Access) came off the **file server** → `imported_from_path` (shown as text; real URLs need a later PnP run against the Access site).
- **The connected Microsoft 365 (MCP) is the Kane PC tenant — it cannot read Pyramid's SharePoint.** OFFICE PROJECTS is a *separate* tenant William accesses as a guest; Graph search doesn't cross tenants. The folder list had to come from a script on Pyramid's side (PnP `-UseWebLogin`, or `Get-ChildItem` off the mapped O:/X: drives — the no-module path that always works).
- **PnP.PowerShell 3.x needs PowerShell 7.4**; on Windows PowerShell 5.1 use PnP `1.12.0`, or skip PnP entirely and read the mapped drives with `Get-ChildItem`.

## Hand-off
109 numbers live and linked (archive link now shows on ProjectDetail). Open: staff resolve the 174 pick-one + 73 contended in the report/worksheet → send back → second UPDATE; PnP run against the Access site to swap the 37 IRA `imported_from_path` for real `archive_folder_url`.
