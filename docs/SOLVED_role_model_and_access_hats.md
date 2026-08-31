# SOLVED — Jorge's 8-role model + Tool/Billing hats, and the access seed

**App:** Pyramid Restoration Staff Portal (app.pyramidny.com)
**DB:** Supabase `izjaxmcdlsdkdliqjlei` (PYRAMID CLIENT COMMAND)
**Module:** Permissions — `profiles.role`, `tool_access`, `billing_access`, Team Management
**Date:** 2026-08-31
**Status:** APPLIED & VERIFIED in production. 31 staff loaded. POLICY rewrite still outstanding.
**Migrations:** `12_role_model_jorge8.sql` (schema), `13_seed_access_matrix.sql` (data)
**Commits:** `ad2904b`, `5e4b103`, `53b84bb`, `e141881`

---

## PROBLEM

Jorge delivered a permission matrix defining **8 base roles** plus two add-on
"hats" (Tool, Billing) that layer on any role, and asked for ~25 staff to be set
up against it.

The matrix could not be applied as a data load. Five separate blockers:

1. **The role vocabulary didn't exist.** The `user_role` enum held 12 job-title
   roles (`director_of_operations`, `project_manager`, `assistant_pm`,
   `sales_rep`, `estimating_coordinator`, `purchasing_manager`,
   `billing_coordinator`, `office_manager`, `field_crew`, `tool_manager`, plus
   `admin`, `task_manager`, `estimator`). Only three of Jorge's eight matched by
   name. Writing `pm` or `overseer` returned
   `Invalid role. Must be one of: ...` from the project-proxy `VALID_ROLES` check.
2. **No hats.** Tool access was a *role* (`tool_manager`), not an add-on, so
   Jesus Cruz could not be "PM who also runs the tool crib" without inventing a
   role for it. Billing had no representation at all.
3. **No email addresses.** `staff_whitelist` is keyed on email — the profile
   auto-creates on first Azure AD login via
   `handle_new_user_from_whitelist` — and neither the matrix nor the prepared
   worksheet carried one.
4. **Two matrix capabilities don't exist in the app.** There is no billing
   feature (`billing.html` was deleted; `billing_coordinator` was an unused enum
   value), and the matrix's top row — "which projects they see: All / All in div
   / Assigned" — is not enforced anywhere. `ProjectList.jsx` filters on a UI
   division toggle, not on the viewer.
5. **Reconciliation gaps** only visible by diffing three sources (matrix, M365
   directory export, live portal). See HAND-OFF.

---

## FIX

### 1. Keep the DB identifiers, change the labels

Root cause of the vocabulary problem was a false choice: the *stored value* and
the *displayed name* had been treated as the same thing. They aren't.

`TeamManagement.jsx` already mapped `value` → `label`. So Jorge's names went on
the labels and the legacy identifiers stayed as the values. Only one genuinely
new enum value was needed:

```sql
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'overseer';
```

| Jorge's name | DB identifier (unchanged) |
|---|---|
| Admin | `admin` |
| Overseer | `overseer` ← new |
| Director | `director_of_operations` |
| Task Manager | `task_manager` |
| PM | `project_manager` |
| PM Asst | `assistant_pm` |
| Estimator | `estimator` |
| Field Tech | `field_crew` |

Zero live logins disturbed. The six job-title roles Jorge's model folds into
"base role + hat" were moved to a **"Retired — being phased out"** `<optgroup>`
rather than deleted — Postgres cannot drop enum values, and more importantly a
current holder (Olivia on `sales_rep`, Solimar on `estimating_coordinator`)
would otherwise have rendered as a blank `<select>`.

### 2. Hats as text + CHECK, NOT NULL

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tool_access text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS billing_access text NOT NULL DEFAULT 'none';
-- same on staff_whitelist, + CHECK (tool_access IN ('none','tech','admin'))
--                            CHECK (billing_access IN ('none','view','admin'))
```

`text` + `CHECK` rather than enums, matching the precedent set by `tools.status`
in `05_tool_control.sql` — new tiers are a one-line migration instead of
`ALTER TYPE`. `NOT NULL DEFAULT 'none'` rather than nullable (the original plan)
so the permission check never distinguishes NULL from `'none'`; a null-vs-'none'
ambiguity in a column gating financial writes is not worth the risk.

The tool hat is backfilled from the retiring role **before** any base role moves:

```sql
UPDATE public.profiles SET tool_access = 'admin'
 WHERE role::text = 'tool_manager' AND tool_access = 'none';
```

(In the event this matched zero rows — nobody was on `tool_manager`. The
`tool_manager` fallback clauses left in `Layout.jsx` / `ToolControl.jsx` /
`Sidebar.jsx` are therefore dead and can be deleted.)

### 3. "Both" division needed no migration at all

`Sidebar.jsx` had been rendering `division: null` as **"All Divisions"** since it
was written:

```js
const DIVISION_LABELS = {
  regular: {...}, ira: {...},
  null: { label: 'All Divisions', ... },
}
```

So "Both" was already the behavior — it was merely *labelled* `(none)` on the
Team page and rendered `—` in the list. Relabelling was the entire fix.

**Do not add a literal `'both'` value.** The division type is shared with
`projects`, where a project must be Regular or IRA and never both; adding it
would make an invalid state expressible on the projects table.

### 4. Tool Control was unreachable for hat-holders

`Sidebar.jsx` gated the Tool Control nav item on `adminOnly: true`. Anyone given
Tool: Tech (the warehouse account, Nina) would have had the hat and no way to
reach the page. Now gated on the hat, with enroll/edit/retire held at the Tool
Admin tier per the matrix:

```js
const canSeeTools = isAdmin || (profile?.tool_access && profile.tool_access !== 'none')
const canManageTools = isAdmin || profile?.tool_access === 'admin'
```

### 5. Seed via `update_profile`, not `upsert_whitelist`

`upsert_whitelist` does `division: division ?? null`, which would have wiped the
divisions already set by hand on eight people. `update_profile` only writes
fields actually passed. Existing staff go through the former, new invites the
latter.

### 6. Two SQL traps hit while writing the seed

**Schema-qualified conflict target is rejected.** This fails:

```sql
ON CONFLICT (email) DO UPDATE
  SET title = COALESCE(public.staff_whitelist.title, EXCLUDED.title)   -- ERROR
```

The conflict target must be referenced by *unqualified* table name
(`staff_whitelist.title`). The 17 updates would have applied and then rolled
back on the 6 inserts.

**`staff_whitelist.role` may be enum or text** depending on when it was created,
so that update runs through dynamic SQL keyed off `information_schema.columns`
rather than guessing.

---

## KEY LEARNINGS

- **Stored value ≠ displayed name.** Half of a "we need to rename all the roles"
  problem was a label lookup that already existed. Check the render path before
  planning a migration.
- **Grep the render for NULL before adding a value to represent "all".** The
  app had encoded null-means-both for months.
- **Deploying the frontend before the edge function fails silently, not loudly.**
  `update_profile` builds its update from a fixed allow-list and *ignores*
  unknown keys — so hat saves would have returned 200 and changed nothing. This
  is worse than an error. Deploy order is **SQL → edge function → frontend**,
  and it is not optional.
- **`profiles` and `staff_whitelist` count differently and both are "the team".**
  11 of 31 staff have never logged in and exist only as whitelist rows with no
  profile. A verification query against `profiles` reads 6 admins where the Team
  screen reads 7. Predicting the wrong number makes a correct run look failed.
- **Edge function deploys need `--no-verify-jwt`** (Azure AD tokens aren't
  Supabase-signed). Deploy from the repo via CLI, never by pasting into the
  dashboard editor — the archive already records a SQL file being saved over
  `project-proxy/index.ts` that way.

---

## VERIFIED (2026-08-31, production)

```
admins 6 · billing_admins 3 · tool_hats 3      -- profiles-only counts, as predicted
```

Team screen: **31 active · 18 pending first login** (was 25 · 12). Admin count
9 → 7. Aashtha → Task Manager, Jesus → PM, Noemi → Overseer, Olivia → Admin.
Hats rendering: Jorge and Jesus on Tool: Admin + Billing: Admin, Nina on Tool:
Tech + Billing: Admin, Billing: View across the PMs and Directors.

---

## HAND-OFF / REMAINING

### Deliberately not seeded — needs Jorge

- **Four people live in the portal, absent from both the matrix and the M365
  directory export, none has ever logged in:** Luis Reyes (**Vice President,
  still holds Admin**), Belarminio Peralta, Lola Berisha, Martin Guzman. Likely
  former staff or never onboarded. Left untouched so Jorge decides rather than
  inheriting a guess.
- **Naomi Hoffman** sits behind the shared `Collections@` mailbox and isn't on
  the matrix. Shared mailboxes make poor logins — every action records as
  "Collections", defeating the audit trail.
- **Billing: View lands on 14 people** as the matrix reads. Nothing is exposed
  today because no billing feature exists, but confirm before one does.

### Email mismatches — NOT fixable on the Team screen

Team Management can change role, division and hats but **not email**, because
email is the whitelist key. These need a new row plus retiring the old one:

| | Portal has | M365 UPN says |
|---|---|---|
| Victor Ortiz | `vortiz@pyramidny.com` | `vsortiz@pyramidny.com` |
| Jesus Cruz | `jcruz@pyramidny.com` (works, Active) | `purchasing@pyramidny.com` |

Victor has never been able to log in; the non-matching address is almost
certainly why. He is excluded from the seed entirely rather than have settings
written onto a row nobody can sign into.

### Still to build

**The POLICY rewrite is the real remaining work.** This change altered what
people *are*; it did not touch what they can *do*. `permissions.js` and its
`project-proxy` mirror still read `["admin"]` for `create_project`,
`update_project_fields`, `upload_file`, `assign_team` and `edit_milestones`,
where Jorge's matrix opens create-bid to Overseer/Director/Task Manager and file
upload to everyone. Both files must change together — they are a deliberate
mirror.

Also unbuilt: the matrix's project-visibility scoping (All / All in div /
Assigned). `division` remains display-only until that lands.

### Regression watch

- Anything reading `profile.role` directly still assumes the old vocabulary.
  `Layout.jsx:49` and `ToolControl.jsx` were fixed; grep for others before
  adding features.
- Deactivate-then-reinvite restores from `staff_whitelist`, so hat changes are
  mirrored there by `update_profile`. If that mirror is ever removed, stale
  access silently returns.
