# Pyramid Field Command — Sprint RECAP

Generated: April 15, 2026

## Project

* **Repo:** pyramidny/PYRAMIDNY
* **Live:** https://app.pyramidny.com
* **Netlify:** pyramidapp.netlify.app
* **Supabase:** izjaxmcdlsdkdliqjlei
* **Stack:** Vite/React/Tailwind, Supabase (PostgreSQL + Edge Functions), Azure AD PKCE, Netlify

---

## ✅ AUTH — FULLY WORKING (April 15, 2026)

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

### What Was Fixed Today

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
* Bill (app@pyramidny.com) — Platform Admin

---

## 🔲 NEXT SPRINT

### Immediate
* Jorge to test first login + confirm Azure admin consent for SharePoint scopes (Sites.ReadWrite.All, Files.ReadWrite)
* 21 additional staff pending Jorge's role document approval
* Noemi Santos role still TBD

### Remaining Screens
* ProjectDetail — inline team assignment editing (currently read-only in sidebar)
* Settings page (placeholder only)
* Notifications (placeholder only)

### Known Outstanding
* SP folder auto-creation on new project needs testing with fresh login (Graph scopes)
* SP_DRIVE_ID env var needed for folder creation (project-proxy checks for it)

---

## Architecture Notes

### Edge Functions
* `create-project` — JWT verify OFF ✅
* `update-project` — JWT verify OFF ✅
* `upsert-production` — JWT verify OFF ✅
* `project-proxy` — JWT verify OFF ✅

---

## Footer

© 2026 Kane PC / Pyramid Restoration Specialists
