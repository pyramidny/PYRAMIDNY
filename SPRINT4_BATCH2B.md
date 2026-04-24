# Sprint 4 / Batch 2b — Documents + Photos + Team Management
Date: April 24, 2026
Status: **STAGED — awaiting verification**

---

## What this batch builds

1. **Files tab → Documents + Photos tabs** on ProjectDetail
2. **Team Management page** with invite / edit / deactivate / reactivate / hard delete
3. **Staff audit log** table for compliance / off-boarding records

---

## FIX & FEATURE DETAIL

### Documents tab (replaces Files tab)

- Category picker for uploads (10 categories: Contracts, Permits, Insurance, etc.)
- File list grouped by category (empty groups hidden)
- Each row: filename, size, upload date, uploader name, SharePoint link, delete button
- Reads from `project_documents` instead of browsing SharePoint — single source of truth
- Delete = soft (flips `is_deleted=true`) + attempts SharePoint removal

### Photos tab (new)

- Category picker + **mobile camera capture** via `accept="image/*" capture="environment"` — field crew can photograph directly from phone
- Thumbnail grid (2-4 columns responsive) with 6 categories: Before, Progress, After, Permits_Posted, Damage, Other
- Filter buttons to show All or one category
- Click thumbnail → lightbox modal with "Open in SharePoint" button
- Hover shows filename + date overlay
- Each photo has a category badge

### Team Management (`/team`)

**Access:** Admin role only. Non-admins see a polite message.

**Three tabs:**
- **Active** — all staff with `is_active=true`. Includes both profiles (logged in at least once) and whitelist-only entries (invited, pending first login — shown as "Invited" status).
- **Inactive** — deactivated staff, with Reactivate button.
- **Admin Panel** — hard delete + audit log viewer.

**Row statuses:**
- `Active` green — has profile, logged in, active
- `Invited` amber — on whitelist, has not logged in yet
- `Deactivated` gray — `is_active=false`

**Invite flow:** Click "+ Invite Staff" → form → writes to `staff_whitelist` → person can now log in via Azure AD → existing `handle_new_user_from_whitelist` trigger auto-creates their profile on first login.

**Off-boarding:**
- **Deactivate** (main tab) → `is_active=false` on both profile + whitelist. Reversible. Data preserved.
- **Hard Delete** (admin panel only) → requires typing "DELETE" to confirm + optional reason. Wipes profile + whitelist. Audit log row preserved with `old_values` intact.

### Staff audit log

New table `staff_audit_log` tracks every add / role change / deactivate / reactivate / hard delete.

Schema: `(id, email, action, changed_by, old_values jsonb, new_values jsonb, notes, created_at)`.

Admin panel shows last 50 entries with who made the change.

---

## PROXY ACTIONS ADDED

| Action | Description | Who can call |
|--------|-------------|--------------|
| `upsert_whitelist` | Invite or update whitelist entry. Also reactivates profile if one exists. | Admin only |
| `update_profile` | Change role / division / title for an existing user. Mirrors role to whitelist. | Admin only |
| `deactivate_staff` | Soft off-boarding. Flips is_active=false on profile + whitelist. | Admin only |
| `reactivate_staff` | Reverse a deactivation. | Admin only |
| `hard_delete_staff` | Destructive. Requires `confirm=true` in body. Writes audit FIRST so delete doesn't orphan audit trail. | Admin only |
| `delete_file` | Soft delete document + remove from SharePoint (best-effort) | Any user |
| `upload_file` | Updated to include `category` on the inserted document row | Any user |

---

## DEPLOY ORDER

### Step 1 — SQL migration

Supabase Dashboard → SQL Editor → paste `sprint4_batch2b.sql` → Run.

Expected output (at end of script):
```
column_name | data_type
-----------+-----------
category   | text

audit_log_readable | profiles_readable | whitelist_readable
-------------------+-------------------+--------------------
         0         |         2+        |         4+
```

### Step 2 — Deploy Edge Function

```powershell
cd C:\Users\Bill\Documents\PYRAMID-COMMAND
# Replace supabase/functions/project-proxy/index.ts with new version
supabase functions deploy project-proxy --project-ref izjaxmcdlsdkdliqjlei
```

Confirm in dashboard: project-proxy → Settings → **Verify JWT OFF**.

### Step 3 — Add TeamManagement route

**You'll need to add the route to your router.** Find where your other routes are defined (likely `src/App.jsx` or `src/router.jsx`), and add:

```jsx
import TeamManagement from '@/pages/TeamManagement'

// Inside your <Routes>:
<Route path="/team" element={<TeamManagement />} />
```

If you're not sure where this is, paste me your current App/router file and I'll write the exact edit.

Your sidebar already has a "Team" link based on the screenshot earlier — it just needs to route to `/team`. Check `Sidebar.jsx` (or wherever the nav lives) to confirm the Link points there.

### Step 4 — Push client

```powershell
git add src/pages/ProjectDetail.jsx src/pages/TeamManagement.jsx supabase/functions/project-proxy/index.ts sprint4_batch2b.sql SPRINT4_BATCH2B.md
git commit -m "Sprint 4 Batch 2b: Documents + Photos + Team Management"
git push origin main
```

---

## TESTING CHECKLIST

### Documents tab
- [ ] Open a project → Documents tab loads with upload bar + category picker
- [ ] Upload a PDF to "Contracts" category → row appears grouped under Contracts
- [ ] SharePoint folder `[Project]/Files/Contracts/` has the file
- [ ] Delete button on row → confirms → disappears from list + from SharePoint
- [ ] Upload to multiple categories → each group shows only its own files

### Photos tab
- [ ] Open Photos tab on project
- [ ] Upload an image from desktop to "Before" → thumbnail appears in grid
- [ ] On phone (after Netlify deploys): "Take / Upload Photo" opens camera directly
- [ ] Category filter buttons toggle correctly — "Before" button shows only Before photos
- [ ] Click thumbnail → lightbox opens → "Open in SharePoint" link works
- [ ] Hover shows filename + date overlay (desktop)
- [ ] Delete × button works

### Team Management
- [ ] Navigate to /team as admin → loads with Active/Inactive/Admin Panel tabs
- [ ] Active tab shows all 4 existing staff + yourself
- [ ] Click "+ Invite Staff" → modal opens → submit with test email → row appears as "Invited"
- [ ] Click Edit on a row → role dropdown → change → Save → badge updates
- [ ] Click Deactivate on someone (not yourself) → confirms → moves to Inactive tab
- [ ] Click Reactivate on Inactive tab → moves back to Active
- [ ] You cannot deactivate yourself (button hidden)
- [ ] Admin Panel → Hard Delete modal → type wrong word → button disabled
- [ ] Type "DELETE" → button enabled → click → row vanishes from all tables
- [ ] Audit log shows the action just performed
- [ ] Non-admin user (if you have one) navigating to /team sees the blocked message

### Regression
- [ ] Milestone editing still works
- [ ] Task toggles still save
- [ ] New project creation still works with SharePoint + tasks

---

## ARCHITECTURE NOTES

**Pattern B (Whitelist-as-Invite)** is the invite model:
- Adding to `staff_whitelist` IS the invite — no email sent, no token link
- Person logs in via Azure AD → DB trigger `handle_new_user_from_whitelist` copies whitelist → profiles row automatically
- Login rejection: app needs to check `profile.is_active` on every page load. Login itself is not blocked (Azure AD doesn't know about us), but inactive profiles should short-circuit access in a ProtectedRoute component.

**⚠️ Not implemented yet, worth flagging:** if a deactivated user logs in with their Azure AD creds, they'll create a broken session because the trigger will refuse to recreate their profile (email already exists) but the client won't know to kick them out. This is a separate hardening task — belongs in Batch 2c or earlier:

```jsx
// In ProtectedRoute.jsx or AuthContext
if (profile && !profile.is_active) {
  signOut()
  alert('Your access has been deactivated.')
  return <Navigate to="/login" />
}
```

Will handle this on next iteration.

**Category-as-subfolder is authoritative.** The `category` column on `project_documents` directly names the SharePoint path. Adding a new category = add to the `DOCUMENT_CATEGORIES` / `PHOTO_CATEGORIES` arrays in ProjectDetail.jsx + make sure project folders are seeded with that subfolder (`SP_SUBFOLDER_TREE` in proxy's index.ts). Don't just add on the client — SharePoint won't have the folder and upload will fail.

---

## FILES CHANGED

| File | Change |
|------|--------|
| `supabase/functions/project-proxy/index.ts` | +6 actions: upsert_whitelist, update_profile, deactivate_staff, reactivate_staff, hard_delete_staff, delete_file. Updated upload_file to persist category. |
| `src/pages/ProjectDetail.jsx` | Removed useSharePoint hook. Added Documents tab (grouped list). Added Photos tab (grid + lightbox). Upload now has category picker. Delete button per document. |
| `src/pages/TeamManagement.jsx` | NEW. Admin-only team roster with invite/edit/deactivate/reactivate/hard-delete. |
| `sprint4_batch2b.sql` | Migration: project_documents.category column + staff_audit_log table + RLS on profiles/audit log/documents. |
| Your router file (TBD) | Add /team route |

---

## NEXT AFTER 2B VERIFIES

1. Inactive-user hard-block in ProtectedRoute (the flag above)
2. Task assignment UI (inline assignee dropdown on tasks)
3. MyTasks PostgREST query fix (broken OR filter on joined column)
4. Settings page (wire to notification_settings)
5. Notifications inbox (all schema is there)
6. Bulk seed of Jorge's real project list
