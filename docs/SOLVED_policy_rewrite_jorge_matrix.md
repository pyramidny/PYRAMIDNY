# SOLVED — POLICY rewrite: Jorge's capability matrix wired into both enforcers

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**DB:** Supabase `izjaxmcdlsdkdliqjlei` (PYRAMID CLIENT COMMAND)
**Module:** Permissions — `src/lib/permissions.js`, `supabase/functions/project-proxy/index.ts`
**Date:** 2026-09-02
**Status:** Code APPLIED, builds clean, `deno check` clean. **Edge function NOT yet deployed.**
**Source of truth:** Jorge's capability matrix PDF, Sep 2026 (24-person roster + 3 tables)

---

## PROBLEM

Reported symptom: **Aashtha Baniya (Task Manager, Billing: View) could not edit or
assign tasks.** Her role was correct in the database — the seed had applied
cleanly. The capability policy simply had never been taught what a Task Manager
is allowed to do.

`12_role_model_jorge8.sql` and `13_seed_access_matrix.sql` changed what people
**are**. Nothing changed what they can **do**. `permissions.js` still read:

```js
assign_task:   ["admin", "director_of_operations"],
edit_any_task: ["admin"],
```

`task_manager` appeared in neither, so `ProjectDetail.jsx` rendered her assignee
dropdown as static text and disabled her checkbox on any task not personally
assigned to her. The `project-proxy` mirror carried the same two-role list.

Four further faults shared the one root cause, plus one that did not:

1. **Overseer had zero capabilities.** The `overseer` string appeared in no
   POLICY array at all — five people (Larry Zyma, Pamela Martinez, Andre
   Higginson, Noemi Santos, Claudia Garcia) could do only the `"*"` actions.
2. **The Tool hat was half-wired.** Sidebar and Layout read `tool_access`, but
   the proxy still gated enroll/edit/retire on `role === "tool_manager"` — a
   role the 8-role model retired and nobody holds. Jesus Cruz (Tool: Admin)
   would see the "Add" tab and get a 403 from it.
3. **The Billing hat gated nothing.** `billing_access` was read only in
   TeamManagement for display. Seeded but inert.
4. **Seven capabilities had no server-side check whatsoever.** `permissions.js`
   claimed `["admin"]`; the proxy enforced nothing. `update_task`,
   `update_milestone`, `upload_file`, `delete_file`, `insert` (create project),
   `update_project` (assign team) and `backfill_project` accepted any request
   with a decodable JWT. The "own tasks only" rule existed *only* in the UI, so
   any signed-in user could complete or reopen any task on any project.
5. **Three orphaned edge functions bypass everything** — see HAND-OFF.

---

## FIX

Root cause: the policy table was written for the old 12-role job-title
vocabulary and never revisited when the 8-role model landed. It also had no
enforcement wired to it on the server for most capabilities.

### 1. Transcribed the matrix into a single 21-capability table

Both files now carry an identical POLICY block. Corrections against what the
code previously assumed — note that two of them are *narrower* than a naive
"seniority" reading would give:

| Capability | Matrix says | Was |
|---|---|---|
| `create_project` | Admin, Overseer, Director, Task Mgr | Admin |
| `update_project_fields` | Admin, Director ◐, Task Mgr ◐, PM ◐ | Admin |
| `advance_stage` | Admin, Director ◐, PM ◐ — **Task Mgr is —** | Admin |
| `assign_team` | Admin, Director ◐, Task Mgr ◐ — **PM is —** | Admin |
| `assign_task` | Admin, Director ◐, Task Mgr ◐, PM ◐ — **Overseer is —** | Admin, Director |
| `edit_production` / `edit_milestones` | Admin, Director ◐, PM ◐ | Admin |
| `upload_file` | everyone, incl. Field Tech | Admin |
| `view_clients` | everyone **except Field Tech** | `"*"` |
| `create_client` / `edit_client` | Admin, Director, Task Mgr ◐, PM ◐ | 8 roles, 3 of them retired |
| `delete_file`, `delete_client`, `move_site`, `manage_staff` | 🔒 Admin | unchanged ✓ |

The old `assign_task` list was **inverted** relative to the matrix: it granted
Overseer (who Jorge marks —) and withheld PM (who Jorge marks ◐).

### 2. Every mutating proxy action now runs through one gate

```ts
function allow(action: string, caller: Caller): caller is NonNullable<Caller> {
  const allowed = POLICY[action];
  if (!allowed) return false;              // unknown capability = closed
  if (!caller || !caller.is_active) return false;
  if (allowed.includes("*")) return true;
  return allowed.includes(caller.role);
}
```

Declared as a **type predicate**, not `boolean` — that is what lets
`if (!allow(...)) return json(...)` narrow `caller` to non-null for the rest of
each handler. Returning `boolean` produces 11 `'caller' is possibly null` errors
downstream.

The `is_active` check inside `allow()` is new: a deactivated account holding a
live JWT previously kept full write access.

`update_task` gained the own-task carve-out the UI had been faking:

```ts
const isOwnTask = !!existing.assigned_to_id && existing.assigned_to_id === caller.id;
if (!allow("edit_any_task", caller) && !isOwnTask) {
  return json({ error: "Not authorized to edit this task" }, 403);
}
```

### 3. The generic `update` action picks its capability from the payload

A trap worth naming. `ProjectDetail.jsx` routes stage changes, status changes
and ordinary field edits all through `action: 'update'`. Jorge scores those rows
differently — Task Manager is ◐ on "Edit project details" but **—** on "Advance
or change project stage". Gating `update` on `update_project_fields` alone would
hand the stage control to every field editor:

```ts
const touched = Object.keys(updates ?? {});
const needed = touched.includes("current_stage") ? "advance_stage"
             : touched.includes("status")        ? "update_project_status"
             : "update_project_fields";
if (!allow(needed, caller)) return json({ error: "Not authorized to make this change" }, 403);
```

### 4. Hats became ranked ladders, not equality checks

`tool_access === 'admin'` at a call site silently locks out the tier above it.
Both hats now compare by rank, with base-role Admin as a superuser:

```js
const TOOL_RANK = { none: 0, tech: 1, admin: 2 }
export function canTool(profile, tier = 'tech') {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return (TOOL_RANK[profile.tool_access] ?? 0) >= (TOOL_RANK[tier] ?? 99)
}
```

Tool tiers now match the matrix exactly:

- **any role, no hat** — view catalog, check a tool out / in
- **tech** — + log maintenance, print QR tags, run utilisation reports
- **admin** — + enroll, edit details, retire

That first row corrected a mistake made earlier in this same session: Tool
Control had been gated on holding the tech hat. Jorge's "Basic use (any role)"
column says otherwise, so the nav item now has **no gate at all** and the
`toolOnly` flag was removed from the sidebar.

`canBill` is built to the same shape and is **not yet consumed** — the billing
screens don't exist.

### 5. Incidental fix — `move_site` audit logging

`writeAudit(caller.id, "move_site", {...})` was called with 3 args against a 5–6
arg signature: the profile id landed in `email`, the payload object in
`changedBy`, and old/new values were never passed. A `.catch(() => {})` swallowed
the resulting insert failure, so **every site move audited as nothing**. Now
called correctly with `caller.email`, `caller.id`, and both value sets.

---

## HAND-OFF

### Deploy this or nothing changes

The frontend is built. **The edge function is not deployed.** Aashtha stays
blocked until it is:

```bash
npx supabase@latest functions deploy project-proxy --project-ref izjaxmcdlsdkdliqjlei --no-verify-jwt --use-api
```

Three details, each of which is an outage or an error if dropped:

- **`--no-verify-jwt` is mandatory.** This function has had gateway JWT
  verification OFF since April 2026 because Azure AD tokens are not Supabase
  JWTs (see "Azure AD writes returning 401 through the proxy" in
  `SOLVED_PROBLEMS.md`). `functions deploy` defaults it back ON. Deploying
  without this flag re-breaks every write in the app instantly.
- **`--use-api`** bundles server-side. Without it the CLI wants Docker, which is
  not installed on the workstation.
- **`npx supabase@latest`**, not bare `supabase` — the CLI is not installed
  globally and is not a project dependency. Run `npx supabase@latest login`
  once first; it opens a browser.

Deploy the function **before or with** the frontend. The frontend now shows
controls to Directors, Task Managers and PMs that the old deployed function will
still 403.

Verify with Aashtha (`abaniya@pyramidny.com`, Task Manager): she should see the
assignee dropdown on project tasks, be able to assign one, tick any task, and
create a client. She should **not** see the stage advance/back controls.

### ⚠ None of this is a security boundary yet

`project-proxy` decodes the JWT with `atob()` and **never verifies the
signature**, and Supabase JWT verification is OFF for the function:

```ts
function parseJwtPayload(token: string) { ... JSON.parse(atob(b64...)) }
const userId = (payload.oid ?? payload.sub) as string | undefined;
```

Anyone can mint `{"oid": "<any azure_oid>"}`, base64 it, and be that person.
POLICY governs honest clients only. Fixing this means verifying the Azure AD
RS256 signature against the tenant JWKS (or turning Supabase JWT verify on and
reconciling the Azure-AD-vs-Supabase-JWT mismatch that turned it off). Treat as
the top security item.

### ⚠ Three orphaned edge functions bypass POLICY entirely

`create-project`, `update-project` and `upsert-production` are documented as
legacy and have no frontend caller, but if still deployed they write to the DB
with the service_role key:

- `update-project` and `upsert-production` check only that an `Authorization`
  **header exists** — never parsed, never validated. Unauthenticated writes.
- `create-project` parses the JWT without verifying it (its own comment says so).

Either delete them from the project or add the same `allow()` gate. Deleting is
cleaner — nothing calls them.

### The ◐ rows are granted unscoped

Six capabilities Jorge marked ◐ ("scoped to their division / assigned jobs") are
enforced as a flat yes, because the app has no project-visibility predicate.
**A PM can currently edit any project, not just their assigned ones.** Wider
than Jorge signed off on, narrower than nothing. The list is exported as
`SCOPED` in `permissions.js` — that array is the work queue when the visibility
feature lands. This is the largest unbuilt part of the matrix.

### `view_clients` is UI-only

Field Tech is the one role Jorge excludes from the client list, and the nav item
now hides for them. But `ClientList.jsx` reads `clients` **directly through
supabase-js**, not the proxy — so the real gate is that table's RLS policy.
Confirm RLS matches before calling this enforced.

### Open questions for Jorge

1. **`edit_any_task` is not in the matrix.** There is "complete their own
   assigned tasks" and "assign a task to a person", but no row for completing
   *someone else's* task. Aligned with `assign_task` on the reading that whoever
   hands a task out can close it out. This is the only inferred capability.
2. **Gabriel Hurtado has no role** in the matrix — the Main column is blank. He
   is live as `project_manager` / IRA and the seed left him there.
3. **Warehouse** (`wh@pyramidny.com`) has no base role either, only Tool Tech.
   Seeded as `field_crew` + tech hat as a floor.
4. **Victor Ortiz** is in the matrix as PM + Billing: View but remains held —
   portal has `vortiz@`, M365 UPN is `vsortiz@`. Still needs a new row and the
   old one retired; he has never logged in.
5. **Belarminio Peralta, Lola Berisha, Luis Reyes, Martin Guzman** are still
   absent from the matrix. Luis Reyes still holds Admin.

### Regression watch

- The two POLICY blocks are a **deliberate mirror**. Drift between them is a
  security hole, not a cosmetic bug. Change both or neither.
- Adding a capability key to `permissions.js` without a matching `allow()` call
  in the proxy creates a UI control with no server enforcement. That is exactly
  how the seven ungated actions above happened.
- `allow()` returns false for unknown capabilities, so a typo fails closed.
  Good, but silent — check the string if a control vanishes.
