# Sprint 4 — Milestone Inline Editing
Date: April 24, 2026
Branch: main
Status: **STAGED — awaiting user verification**

---

## PROBLEM

Milestones tab was read-only AND quietly broken. The UI was reading columns that don't exist in the schema:

| UI was reading | Actual column in `project_milestones` |
|----------------|----------------------------------------|
| `ms.status`    | `value` (enum: Yes / No / Missing / N/A) |
| `ms.target_date` | `milestone_date` (DATE) |
| — (not shown) | `notes` (text) |

Result: every milestone rendered with an undefined status pill and no date, regardless of what was in the database.

Milestones were also sorted by `updated_at` instead of `milestone_definitions.sort_order`, so order changed every time something was touched.

---

## FIX

**1. Edge Function — `supabase/functions/project-proxy/index.ts`**

Added `update_milestone` action. Follows the same proxy pattern as `update_task`:
- Accepts `{ milestoneId, updates: { value, milestone_date, notes } }`
- Whitelists allowed fields (never passes arbitrary columns)
- Validates `value` against the enum (`Yes | No | Missing | N/A`)
- Stamps `updated_by = userId` (Azure AD oid) and `updated_at = now()`
- Returns the updated row with `milestone_definitions` joined so the client can re-render without a second fetch

**2. UI — `src/pages/ProjectDetail.jsx`**

- Fixed reads to use correct columns (`value`, `milestone_date`, `notes`)
- Client-side sort by `milestone_definitions.sort_order` (Supabase can't order by a joined column directly)
- Per-milestone inline edit: click `Edit` → value dropdown + date picker + notes textarea + Save/Cancel
- Optimistic UI with rollback on proxy failure
- Color coding driven by `value`:
  - `Yes` → green dot + green pill
  - `No` → red
  - `Missing` → amber (default)
  - `N/A` → gray
- Future-stage milestones (where `active_from_stage > project.current_stage`) rendered at 60% opacity with a `Stage N` label — visible but de-emphasized

---

## DEPLOY

```powershell
# From repo root
cd C:\Users\Bill\Documents\PYRAMID-COMMAND

# Replace the two files with the new versions, then:
git add supabase/functions/project-proxy/index.ts src/pages/ProjectDetail.jsx
git commit -m "Sprint 4: Milestone inline editing + fix schema-mismatched reads"
git push origin main

# Deploy the Edge Function (Netlify deploys the UI automatically on push)
supabase functions deploy project-proxy --project-ref izjaxmcdlsdkdliqjlei
```

**Supabase dashboard check:** project-proxy → Settings → "Verify JWT with legacy secret" MUST stay OFF. If it's ON, the function will 401 on Azure AD tokens before executing.

---

## HAND-OFF / TESTING CHECKLIST

Bill to verify on live (app.pyramidny.com) after deploy:

- [ ] Milestones tab loads with correct values (not empty pills)
- [ ] Milestones appear in the right order (by sort_order, not random)
- [ ] Click Edit on a milestone → form opens
- [ ] Change value from Missing → Yes → Save → pill turns green, no reload needed
- [ ] Set a milestone_date → save → date shows in the read view
- [ ] Add notes → save → notes appear in read view
- [ ] Future-stage milestones (active_from_stage > current_stage) appear dimmed
- [ ] Intentionally trigger a failure (disconnect wifi, click Save) → UI reverts to previous value, alert shows error

---

## ARCHITECTURE NOTES (still apply — no changes)

- Azure AD `session.access_token` is still null for all Microsoft users
- All milestone writes go through project-proxy using service_role
- Token still read from `localStorage['sb-izjaxmcdlsdkdliqjlei-auth-token'].access_token`
- project-proxy "Verify JWT" remains OFF in dashboard

---

## NEXT IN SPRINT 4

1. ~~Milestone inline editing~~ ✅ (this doc)
2. Team Management screen — use `staff_whitelist` table to show 21 placeholder staff with `Needs role` flag. Jorge assigns roles in-app instead of approving a doc first.
3. Settings page — wire to `notification_settings` table (schema already exists, this is now a real feature not a placeholder)
4. Notifications screen — `notifications` table + `notification_settings` already in schema. Notify on task assigned, milestone changed, project status change, new project. Insert points go in project-proxy alongside existing write actions.
