# Sprint 4 — Batch 2a: SOLVED ✅
Date completed: April 24, 2026
Total duration: ~2 days (Sprint 4 kickoff → batch 2a complete)

---

## What was achieved

A complete, production-tested foundation for all remaining Sprint 4 work. Every piece was verified end-to-end before declaring done.

### Architecture pieces proven working

1. **Milestone inline editing** — labels populate correctly from `milestone_definitions` join, value/date/notes all save via proxy, optimistic UI with rollback on error.

2. **Task seeding on project insert** — 36 tasks auto-seeded from `workflow_task_templates` based on project division. Auto-assigns to PM/assistant_pm/estimator based on template role.

3. **Production row auto-created** on insert (for awarded projects' checklist).

4. **SharePoint folder tree auto-created** on insert — full 18-subfolder structure (Files/ with 10 subcategories, Pictures/ with 6 subcategories, plus 2 parents).

5. **File uploads to SharePoint working** — verified with 2.27MB JPG upload. Chunked base64 encoding handles any file size.

6. **`project_documents` records created** on upload, with full SharePoint linkage (item_id, url, drive_id, size, mime_type).

7. **Idempotent backfill action** (`backfill_project`) — safe to re-run, only adds missing pieces. Not used in the end because we started fresh, but available for the real bulk-seed of Jorge's project list.

8. **RLS policies** on 5 lookup tables (`workflow_task_templates`, `staff_whitelist`, `notification_settings`, `notifications`, `project_documents`) — preemptive to avoid debug-live situations we hit with `milestone_definitions`.

---

## The three problems we hit and solved

### Problem 1: "Milestone / Milestone / Milestone" placeholder text

**Root cause:** RLS on `milestone_definitions` blocked anon role from reading labels. Browser fetched milestones successfully but the join returned null every time.

**Fix:** Added SELECT policy `USING (true)` for anon + authenticated roles. Lookup tables with no PII get global read access.

**Lesson learned:** Every new lookup table we touch will hit this. Preemptively added RLS policies for the next 4 tables we'll need (workflow_task_templates, staff_whitelist, notification_settings, notifications).

### Problem 2: SharePoint folder creation silently failing forever

**Root cause:** Two issues, discovered sequentially:

**2a:** The Microsoft Graph `provider_token` was missing from localStorage due to a stale session. Fresh login + sign-in consent cycle retrieved it (length 2924 bytes).

**2b:** `SP_SITE_ID` in Supabase function secrets was only the middle GUID, not the full compound format Graph requires. Graph expects `hostname,siteCollectionGuid,webGuid` with both commas.

**Diagnostic breakthrough:** Instead of guessing, ran direct Graph calls from browser console to isolate the problem. Browser call succeeded → function call failed → the only difference was the site ID Supabase was sending.

**Correct format in Supabase secret:**
```
pyramidrestoration.sharepoint.com,a17eb9ff-21a3-4577-982b-be9a012a66a6,3bdfb1e7-a708-45e9-bd92-f2ef407b76c1
```

**Lesson learned:** The "compound site ID" quirk of Microsoft Graph is the kind of thing you lose a day to if you don't test the exact same HTTP call from two different clients. Direct browser Graph tests are a fast diagnostic tool — worth keeping in the debug playbook.

### Problem 3: "Maximum call stack size exceeded" on file upload

**Root cause:** The naive pattern `btoa(String.fromCharCode(...new Uint8Array(buf)))` uses the spread operator, passing every byte as a separate function argument. JavaScript's argument limit blows the stack on any file over ~100KB.

**Fix:** Chunked base64 encoding — loop over 32KB slices, convert each, concatenate.

**Lesson learned:** The spread operator is never the right tool for converting large typed arrays. Subarray-based loop is the standard pattern.

---

## Architecture rules (reinforced — not new)

All rules from RECAP.md Sprint 3 still apply:

- `session.access_token` is ALWAYS null for Azure AD users
- All writes through `project-proxy` using service_role
- Token read from `localStorage['sb-izjaxmcdlsdkdliqjlei-auth-token']`
- `project-proxy` "Verify JWT with legacy secret" stays OFF
- `task_status` enum: `completed` not `complete`

New rule added this batch:

- **Lookup tables need RLS SELECT policies** when Azure AD client reads them directly. Preemptive for: `workflow_task_templates`, `staff_whitelist`, `notification_settings`, `notifications`, `project_documents`, `milestone_definitions`.

- **`SP_SITE_ID` must be the full compound format** (`hostname,siteCollectionGuid,webGuid`) — not just the middle GUID. Microsoft Graph requires it.

- **Supabase dashboard secrets take effect immediately.** No function redeploy required when changing a secret value.

---

## Deployment state

### GitHub (main branch)
- Commits through `0b54543` deployed
- `sprint4_batch2a.sql` in repo root (reference — already executed on Supabase)
- `SPRINT4_BATCH2A.md` + this file in repo root

### Supabase
- `project-proxy` function deployed with all 9 actions:
  - `insert`, `update`, `update_project`, `update_task`, `update_milestone`, `upload_file`, `backfill_project`, `select`, (plus implied options for OPTIONS/OPTIONS preflight)
- JWT verify: **OFF** (confirmed)
- `SP_SITE_ID` secret: full compound format (updated Apr 24 2026)
- RLS policies active on 6 tables

### Netlify
- All frontend pushes auto-deployed
- Build status: green

### Known "expected" placeholder states
- Files tab UI doesn't show uploaded files yet — slated for Batch 2b rebuild
- MyTasks page has a PostgREST query bug (`or=(assigned_to_id.eq.X,project.pm_id.eq.X)` — can't filter on joined field in OR clause). Batch 2b fix.

---

## Ready for Batch 2b

With the foundation proven, Batch 2b becomes pure UI work on reliable data:

1. **Documents tab** — replace the Files tab with category-grouped Documents list. Upload picks category (Contracts, Permits, etc.) → lands in correct SharePoint subfolder. Reads from `project_documents`.

2. **Photos tab** — thumbnail grid, 6 categories (Before, Progress, After, Permits_Posted, Damage, Other). Mobile camera capture support. Also reads from `project_documents`.

3. **Task assignment UI** — inline assignee dropdown on task rows, saves via existing `update_task` action.

4. **MyTasks query fix** — rewrite the broken OR filter to use a two-query pattern or a DB view.

Then Sprint 4 remaining:

5. **Team Management screen** (`staff_whitelist`-backed, shows placeholder staff)
6. **Settings page** (wires to `notification_settings` — now a real feature, not placeholder)
7. **Notifications inbox** (`notifications` + `notification_settings` — schema already exists, UI + insert points needed)
