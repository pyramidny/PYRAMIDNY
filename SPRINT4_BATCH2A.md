# Sprint 4 / Batch 2a — Foundation Fixes
Date: April 24, 2026
Status: **STAGED — awaiting verification**

---

## PROBLEM

Three foundational bugs discovered while investigating the Files tab:

1. **Zero projects have SharePoint folders.** `project.sharepoint_folder_id` is NULL for all 6 existing projects. The proxy's `insert` action had SharePoint creation code but the client never passed `providerToken`, so folder creation was silently skipped every time.

2. **Task seeding inconsistent.** P-0003 has 0 tasks, P-0005 has 3, P-0001 has 57 (likely double-seeded). No trigger on `projects` seeds tasks. There is no reliable mechanism creating tasks from `workflow_task_templates`.

3. **Two separate insert paths.** `NewProject.jsx` calls `create-project` function (basic insert only), while `project-proxy` has a richer `insert` action. Inconsistent code paths = silent drift.

---

## FIX — Batch 2a

### 1. Consolidated to single proxy
`NewProject.jsx` now calls `project-proxy` with `action='insert'`. The `create-project` function is no longer called (can be deleted later; leaving it for now to avoid deploy-order risk).

### 2. Reliable SharePoint folder tree on insert
Per-project folder structure auto-created:

```
[P-0007]_245_Park_Ave/
├── Files/
│   ├── Contracts
│   ├── Change_Orders
│   ├── Permits
│   ├── Insurance_COI_CCI
│   ├── Submittals
│   ├── Plans_Drawings
│   ├── Inspections
│   ├── Correspondence
│   ├── Closeout
│   └── Other
└── Pictures/
    ├── Before
    ├── Progress
    ├── After
    ├── Permits_Posted
    ├── Damage
    └── Other
```

- Creation is best-effort: if any subfolder fails, continues with others.
- Uses user's Microsoft Graph `provider_token` from `localStorage['sb-...'].provider_token` — passed from client to proxy in the insert body.
- Uses `/sites/{id}/drive/root` (default "Documents" library) — no SP_DRIVE_ID needed.

### 3. Reliable task seeding on insert
Seeds from `workflow_task_templates` filtered by `(division = project.division OR division IS NULL) AND is_active = true`. Auto-assigns based on template's `assigned_role`:
- `project_manager` → `project.pm_id`
- `assistant_pm` → `project.assistant_pm_id`
- `estimator` → `project.estimator_id`
- Other roles → null (assigned manually later)

### 4. Empty production row on insert
Auto-inserts `project_production` row tied to the project. Checklist starts with all NULLs.

### 5. New `backfill_project` action
Idempotent fix for existing broken projects. Only adds what's missing:
- No tasks? Seed from templates.
- No SP folder? Create full tree.
- No production row? Create empty one.

Run it as many times as needed, safe.

### 6. New `upload_file` action (wired into proxy, UI comes in Batch 2b)
Takes `projectId`, `category` (e.g. `"Files/Contracts"` or `"Pictures/Before"`), `fileName`, `fileContent` (base64). Uploads to SharePoint at the right subfolder AND records in `project_documents`.

### 7. RLS policies on lookup tables (preemptive)
`workflow_task_templates`, `staff_whitelist`, `notification_settings`, `notifications`, `project_documents` — read access for anon + authenticated. Same class of bug as milestone_definitions from earlier today.

### 8. `update_task` stamps completion metadata
When task status → `completed`, also sets `completed_at = now()` and `completed_by = userId`.

---

## DEPLOY ORDER (IMPORTANT)

Run in this exact order. The proxy must have the new `insert` action before `NewProject.jsx` calls it.

### Step 1 — Run SQL first
Supabase Dashboard → SQL Editor → paste contents of `sprint4_batch2a.sql` → Run.

Expected output:
```
templates_visible | whitelist_visible | settings_visible | notifications_visible | documents_visible
-----------------+-------------------+------------------+----------------------+------------------
     45+         |         5+        |        0+        |          0+          |        0+
```

If any shows 0 and it shouldn't (like templates_visible = 0), RLS didn't take — rerun.

### Step 2 — Deploy Edge Function
```powershell
cd C:\Users\Bill\Documents\PYRAMID-COMMAND
# Replace supabase/functions/project-proxy/index.ts with the new version
supabase functions deploy project-proxy --project-ref izjaxmcdlsdkdliqjlei
```

After deploy, confirm in Dashboard → Edge Functions → project-proxy → Settings:
- **Verify JWT with legacy secret: OFF** ← always check this

### Step 3 — Push client
```powershell
# Replace src/pages/NewProject.jsx with the new version
git add src/pages/NewProject.jsx supabase/functions/project-proxy/index.ts sprint4_batch2a.sql SPRINT4_BATCH2A.md
git commit -m "Sprint 4 Batch 2a: task seeding + SharePoint tree + backfill + RLS"
git push origin main
```

Netlify rebuilds the UI in ~90 seconds.

---

## BACKFILL — fix existing projects

After deploy, open browser dev console at app.pyramidny.com (must be logged in), paste:

```javascript
// Get tokens
const raw = localStorage.getItem('sb-izjaxmcdlsdkdliqjlei-auth-token')
const parsed = JSON.parse(raw)
const accessToken = parsed.access_token
const providerToken = parsed.provider_token
console.log('providerToken present:', !!providerToken)

// Get all projects
const pRes = await fetch('https://izjaxmcdlsdkdliqjlei.supabase.co/rest/v1/projects?select=id,project_number', {
  headers: { 'apikey': 'YOUR_ANON_KEY_HERE', 'Authorization': `Bearer ${accessToken}` }
})
const projects = await pRes.json()
console.log('Projects:', projects)

// Backfill each one
for (const p of projects) {
  const res = await fetch('https://izjaxmcdlsdkdliqjlei.supabase.co/functions/v1/project-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'backfill_project', projectId: p.id, providerToken })
  })
  const j = await res.json()
  console.log(`${p.project_number}:`, j.meta ?? j.error)
}
```

Expected output example:
```
P-0001: { tasks_already: 57, tasks_seeded: 0, sp_created: true, sp_subfolders: 17, ... }
P-0003: { tasks_already: 0,  tasks_seeded: 24, sp_created: true, sp_subfolders: 17, ... }
P-0005: { tasks_already: 3,  tasks_seeded: 0, sp_created: true, ... }
```

**P-0001 and P-0005 note:** Backfill skips task seeding because they already have some tasks. If P-0001's 57 tasks are confirmed duplicates by the SQL diagnostic, we'll clean them up separately (SQL delete, not via proxy).

---

## TESTING CHECKLIST

After deploy + backfill:

### New project creation
- [ ] Create a new project via UI
- [ ] Open browser console → see `[NewProject] created:` log with `tasks_seeded: ~24`, `sharepoint_created: true`, `sharepoint_subfolders: 17`
- [ ] Open the new project → Tasks tab populated
- [ ] Check Supabase → `projects` row has `sharepoint_folder_id` and `sharepoint_folder_url`
- [ ] Open the SharePoint folder URL → see Files/ and Pictures/ with all subfolders

### Existing project verification (after backfill)
- [ ] P-0003 now has tasks in Tasks tab
- [ ] P-0006 and others have SharePoint folder URLs that open correctly
- [ ] Production checklist on Overview (for awarded projects) loads without errors

### Data integrity
```sql
-- Should be zero after successful backfill
SELECT COUNT(*) FROM projects WHERE sharepoint_folder_id IS NULL;

-- Every project should have at least 15 tasks
SELECT project_number, COUNT(pt.id) AS tasks
FROM projects p LEFT JOIN project_tasks pt ON pt.project_id = p.id
GROUP BY p.id, project_number
ORDER BY created_at;
```

---

## WHAT'S STILL PLACEHOLDER

The **Files tab UI** is unchanged in this batch. It will remain mostly empty-looking because:
- The old `useSharePoint` hook calls actions that may not exist on the new proxy
- The upload button only renders with `sharepoint_folder_id` set — which will now be true after backfill, but the upload flow may error until Batch 2b wires it properly

**This is expected.** Batch 2b rebuilds Files → Documents + Photos tabs with working upload and browse.

---

## BATCH 2B PREVIEW (next)

1. ProjectDetail.jsx: Files tab → Documents tab (category-grouped list) + Pictures tab (thumbnail grid)
2. Task assignment UI (inline assignee dropdown)
3. Mobile camera upload for Pictures tab
4. Clean up duplicate tasks on P-0001 if confirmed

Plus Sprint 4 remaining:
5. Team Management screen (`staff_whitelist`-backed)
6. Settings page (wired to `notification_settings`)
7. Notifications inbox

---

## FILES CHANGED

| File | Change |
|------|--------|
| `supabase/functions/project-proxy/index.ts` | Major rewrite: insert adds tasks+SP tree+production, new backfill_project action, new upload_file action, update_task stamps completion |
| `src/pages/NewProject.jsx` | Calls project-proxy instead of create-project, passes provider_token |
| `sprint4_batch2a.sql` | RLS policies + diagnostics (run once) |
| `SPRINT4_BATCH2A.md` | This doc |

`create-project` Edge Function is now unused. Leaving deployed for rollback safety — delete after Batch 2a is verified stable.
