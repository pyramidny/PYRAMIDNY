# Pyramid Field Command — Sprint RECAP
Generated: April 16, 2026

## Project
* **Repo:** pyramidny/PYRAMIDNY
* **Live:** https://app.pyramidny.com
* **Netlify:** pyramidapp.netlify.app
* **Supabase:** izjaxmcdlsdkdliqjlei
* **Stack:** Vite/React/Tailwind, Supabase (PostgreSQL + Edge Functions), Azure AD PKCE, Netlify

---

## ✅ SPRINT 3 — April 16, 2026 (TODAY)

### What Was Fixed

#### 1. ProjectDetail — Team Assignment Save (WORKING ✅)
- **Root cause:** `project-proxy` Edge Function had "Verify JWT with legacy secret" turned ON in Supabase dashboard. The gateway was rejecting Azure AD tokens before the function code ran — the `parseJwtPayload` workaround never executed.
- **Fix:** Turned OFF "Verify JWT with legacy secret" on `project-proxy` in Supabase → Edge Functions → project-proxy → Settings.
- **Also fixed:** `session` from `useAuth()` is always null for Azure AD tokens (Supabase can't verify Microsoft-signed JWTs). `proxy` useCallback and `useEffect` guard were both dependent on `session`. Fixed by reading the token directly from localStorage key `sb-izjaxmcdlsdkdliqjlei-auth-token` via a `getAccessToken()` helper. Removed `!session` guard from useEffect.

#### 2. ProjectDetail — Task Checkboxes Save (WORKING ✅)
- **Root cause:** `toggleTask` called `supabase.from('project_tasks').update()` directly, hitting PostgREST RLS which blocks Azure AD JWTs.
- **Fix:** Rerouted through `project-proxy` using the existing `update_task` action. Added optimistic UI update (instant checkbox toggle) with rollback on failure.

#### 3. ProjectDetail — task_status Enum Mismatch (FIXED ✅)
- **Root cause:** Code was sending `"complete"` but DB `task_status` enum values are: `pending, in_progress, completed, overdue, skipped, na`.
- **Fix:** All 3 occurrences in ProjectDetail.jsx updated to `"completed"`.

### Commits (April 16, 2026)
| SHA | Message |
| --- | --- |
| `8d5cbfb` | Fix 401: read Azure AD token from localStorage in proxy, remove session guard |
| `8274647` | Fix toggleTask: route through proxy instead of direct supabase (RLS bypass) |
| `47d6ff7` | Fix task status from 'complete' to 'completed' |

### Supabase Dashboard Change (non-code)
- `project-proxy` → Settings → **"Verify JWT with legacy secret" turned OFF**
- This is not tracked in code — must be kept OFF. If the function is ever redeployed via CLI use `--no-verify-jwt` flag or set `verify_jwt = false` in `supabase/functions/project-proxy/config.toml`.

### Pattern: Azure AD Token in Edge Functions
```
RULE: Never depend on supabase.auth.getSession() or session.access_token for Azure AD users.
      Supabase cannot verify Microsoft-signed JWTs client-side or server-side.

FOR READS:   Direct supabase calls work if the RLS SELECT policy is permissive (or with check true).
FOR WRITES:  Always go through project-proxy which uses service_role key.
TOKEN:       Read from localStorage key sb-izjaxmcdlsdkdliqjlei-auth-token → access_token.
GATEWAY:     project-proxy must have "Verify JWT" OFF in Supabase dashboard.
```

---

## ✅ SPRINT 2 — AUTH FULLY WORKING (April 15, 2026)

End-to-end login confirmed on both https://app.pyramidny.com and https://pyramidapp.netlify.app in incognito mode.

### Auth Architecture (critical — do not change)
* Azure AD tokens are NOT native Supabase JWTs
* All writes go through Edge Functions using service_role key (JWT verify OFF)
* Reads use user JWT directly with RLS SELECT policies
* `detectSessionInUrl: true` — Supabase auto-exchanges ?code= param on client init
* `lock: async (_name, _timeout, fn) => fn()` — Web Lock bypass in supabase.js (prevents lock conflict between AuthContext getSession and the auto-exchange)
* AuthCallback uses `window.location.href = '/dashboard'` (hard redirect, not React Router navigate) to ensure Supabase client re-initializes cleanly with the stored session

### Key Auth Files
| File | Purpose |
| --- | --- |
| `src/lib/supabase.js` | lock bypass + detectSessionInUrl:true + flowType:pkce |
| `src/pages/AuthCallback.jsx` | Watches session from useAuth(), hard redirects to /dashboard |
| `src/context/AuthContext.jsx` | Session, profile, loading state |
| `src/components/ProtectedRoute.jsx` | Blocks protected routes until loading=false + session set |
| `src/App.jsx` | Catches ?code= at root, forwards to /auth/callback. Never blocks /auth/callback with loading gate |

### What Was Fixed (April 15)
1. SSL cert — moved pyramidny.com DNS from GoDaddy to Cloudflare, cert provisioned instantly
2. VitePWA removed — was generating sw.js with SSL error that blocked fetch on /auth/callback
3. React StrictMode removed — was double-firing effects causing lock conflicts
4. exchangeCodeForSession removed — Supabase auto-exchanges via detectSessionInUrl:true
5. Web Lock bypass added — prevents AuthContext getSession competing with auto-exchange
6. Hard redirect — window.location.href instead of navigate() ensures clean re-init

### Config Verified
| Setting | Value |
| --- | --- |
| Supabase Site URL | https://app.pyramidny.com |
| Supabase Redirect URLs | https://app.pyramidny.com/*, https://pyramidapp.netlify.app/*, exact /auth/callback for both |
| Azure Redirect URIs | https://app.pyramidny.com/auth/callback, https://pyramidapp.netlify.app/auth/callback, https://izjaxmcdlsdkdliqjlei.supabase.co/auth/v1/callback |
| Azure Implicit Grant | Access tokens + ID tokens UNCHECKED |

---

## ✅ COMPLETED — Previous Sprints

### Schema
* 11 tables with RLS, triggers, enums (division_type: regular/ira)
* milestone_definitions lookup table
* workflow_task_templates (45 rows seeded)
* sharepoint_folder_id, sharepoint_folder_url, sharepoint_list_item_id columns on projects

### Edge Functions (JWT verify OFF on all)
* `project-proxy` — handles insert, update, update_task, SP folder creation
* `create-project` — legacy
* `update-project` — project field updates
* `upsert-production` — production record upserts

### Pages Completed
* Login — Azure AD SSO
* Dashboard — project summary cards
* ProjectList — filterable project table
* NewProject / NewBid — project creation form
* ProjectDetail — Overview, Milestones (read-only), Tasks (toggle), Files (SP browser + upload), Team assignment

### SharePoint Integration
* SP_SITE_ID secret in Supabase Edge Function secrets
* VITE_SP_SITE_ID env var in Netlify
* src/lib/sharepoint.js — Graph API utilities
* src/hooks/useSharePoint.js — folder contents + file upload hook
* Documents tab in ProjectDetail with file browser and upload

### Staff Seeded (admin role)
* Jorge Garcia (Jgarcia@pyramidny.com) — Principal / PM
* Nina Lee-Chan (nlee@pyramidny.com) — Office Manager
* Jesus Cruz (jcruz@pyramidny.com) — Purchasing and Logistics
* Omar D. Villa (ovilla@pyramidny.com) — Director of Design
* Bill Kane (app@pyramidny.com) — Platform Admin

---

## 🔲 NEXT SPRINT — Sprint 4

### Prerequisites Before Building
- [ ] Jorge to complete first login + confirm team assignment save works (app.pyramidny.com)
- [ ] Jorge to confirm Azure admin consent granted for SharePoint scopes (Sites.ReadWrite.All, Files.ReadWrite)
- [ ] Jorge to approve role permissions document — unblocks bulk staff load
- [ ] Remove temporary `WITH CHECK (true)` RLS policy once writes are fully proxied

### Screens to Build
- [ ] **Team Management screen** — Add/remove/edit staff users, assign roles (admin, pm, field_crew, etc.)
- [ ] **Settings page** — User preferences, notification preferences (currently placeholder)
- [ ] **Notifications screen** — Alert inbox, mark read (currently placeholder)
- [ ] **Milestone editing** — Update milestone status and target dates inline in ProjectDetail

### Data & Backend
- [ ] **Bulk staff load** — 21 additional staff pending Jorge's role approval
- [ ] **Test SP folder auto-creation** — Verify Graph API creates SharePoint folder on new project with fresh login token
- [ ] **Confirm SP_DRIVE_ID** — project-proxy checks for it; may need to be added as a Supabase secret
- [ ] **Noemi Santos role** — still TBD, hold off on seeding

### Polish / QA
- [ ] Error handling improvements — surface better messages in UI instead of alert()
- [ ] Loading states on team save and task toggle
- [ ] Mobile layout QA on ProjectDetail tabs
- [ ] Confirm task status values match DB enum in all screens (completed / pending / in_progress)

---

## Architecture Reference

### Edge Functions
| Function | JWT Verify | Purpose |
| --- | --- | --- |
| `project-proxy` | OFF ✅ | Main write proxy — insert, update, update_task, SP folder |
| `create-project` | OFF ✅ | Legacy project creation |
| `update-project` | OFF ✅ | Project field updates |
| `upsert-production` | OFF ✅ | Production record upserts |

### DB Enums
| Enum | Values |
| --- | --- |
| `task_status` | pending, in_progress, completed, overdue, skipped, na |
| `project_status` | New Bid, Active Bid, No Bid, Bid Not Awarded, Job Awarded, Active Job, Job Closed |
| `division_type` | regular, ira |
| `user_role` | admin, director_of_operations, sales_rep, estimating_coordinator, estimator, project_manager, assistant_pm, task_manager, purchasing_manager, billing_coordinator, office_manager, field_crew |
| `milestone_value` | Yes, No, Missing, N/A |

### localStorage Token Pattern
```js
// Use this everywhere you need the Azure AD token — session.access_token is always null
const raw = localStorage.getItem('sb-izjaxmcdlsdkdliqjlei-auth-token')
const accessToken = raw ? JSON.parse(raw)?.access_token : null
```

---

## Footer
© 2026 Kane PC / Pyramid Restoration Specialists
