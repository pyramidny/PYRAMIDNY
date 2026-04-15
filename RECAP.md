# Pyramid Field Command — Sprint RECAP
Generated: April 15, 2026

## Project
- **Repo:** pyramidny/PYRAMIDNY
- **Live:** https://app.pyramidny.com
- **Supabase:** izjaxmcdlsdkdliqjlei
- **Stack:** Vite/React/Tailwind, Supabase (PostgreSQL + Edge Functions), Azure AD PKCE, Netlify

---

## ✅ COMPLETED THIS SPRINT (April 15, 2026)

### Auth
- Fixed AuthCallback — replaced localStorage polling with `onAuthStateChange` listener
- Fixed supabase.js — set `detectSessionInUrl: false` to prevent double code exchange race condition
- Removed `lock` mutex override and old `injectAccessToken` workaround
- Moved `/auth/callback` to a proper React Router route (no more window.location hack in App.jsx)
- Updated Supabase Site URL from pyramidapp.netlify.app → app.pyramidny.com
- Confirmed redirect URLs include `/auth/callback` and wildcard `/auth/callback/*`
- Added Graph API scopes to signInWithOAuth: `Sites.ReadWrite.All`, `Files.ReadWrite`

### SharePoint Integration
- `SP_SITE_ID` secret added to Supabase Edge Function secrets
- `VITE_SP_SITE_ID` env var added to Netlify
- Site ID: `pyramidrestoration.sharepoint.com,5d67ffb6-8b4d-48ba-b6b1-527052a38143,77333216-3474-4e23-84aa-44f570047f66`
- `src/lib/sharepoint.js` — Graph API utilities (list folder, upload file, discovery helpers)
- `src/hooks/useSharePoint.js` — React hook for SP folder contents and file upload
- `project-proxy` Edge Function deployed — handles insert + SP folder creation atomically
- SQL migration run: `sharepoint_folder_id`, `sharepoint_folder_url`, `sharepoint_list_item_id` columns added to `projects`
- Documents tab added to ProjectDetail with file browser and upload

### Code Fixes
- `TeamManagement.jsx` — removed `@azure/msal-react` / `useMsal`, replaced with `useAuth` session
- `ProjectDetail.jsx` — removed `@azure/msal-react` / `useMsal`, replaced with `useAuth` session
- `App.jsx` — fixed broken destructured import block for TeamManagement
- `AuthCallback.jsx` — multiple rounds of JSX corruption cleaned up; final version is clean

### Staff / Testing
- 4 test admin users seeded into `staff_whitelist`:
  - Jorge Garcia (Jgarcia@pyramidny.com) — Principal / PM
  - Nina Lee-Chan (nlee@pyramidny.com) — Office Manager
  - Jesus Cruz (jcruz@pyramidny.com) — Purchasing and Logistics
  - Omar D. Villa (ovilla@pyramidny.com) — Director of Design
- All set to `role: admin`, `division: NULL` (both Regular and IRA)
- Profile rows will auto-provision on first login via trigger

### Build
- All `@azure/msal-react` imports removed — build now passes clean ✅
- Netlify deployed: main@0efb28e

---

## ⚠️ KNOWN ISSUE — Auth Redirect Spinner

**Status:** Auth exchange works but spinner doesn't auto-redirect in Firefox/Edge on fresh login.

**Root cause:** `detectSessionInUrl: false` fix was deployed but Netlify needs a new build to pick it up.
After the next deploy with the updated `supabase.js`, the flow should be:
1. Microsoft login → consent → redirect to `/auth/callback?code=...`
2. Spinner shows ~1-2s
3. Auto-redirect to `/dashboard`

**Workaround until fixed:** Manually navigate to `/dashboard` after callback page appears.

**DO NOT email testers yet** — wait for confirmed clean auth flow.

---

## 🔲 OUTSTANDING / NEXT SPRINT

### Auth
- [ ] Confirm auto-redirect works end-to-end in Firefox/Edge after supabase.js deploy
- [ ] Test with Jorge Garcia account (first real user login)

### SharePoint
- [ ] Test SP folder auto-creation on new project (requires fresh login with Graph scopes)
- [ ] The `project-proxy` Edge Function creates folders using `/drive/root/children` (no SP_DRIVE_ID needed)
- [ ] After confirmed working: SP folder button will appear in ProjectDetail Documents tab

### Azure AD App Registration
- Delegated permissions added: `Sites.ReadWrite.All`, `Files.ReadWrite`
- Admin consent must be granted in Azure Portal if not already done

### Broader Staff Roster
- 21 total staff pending — awaiting Jorge's review/approval of role assignments
- Noemi Santos role still TBD
- Only 5 admins active currently (Bill + 4 test users)

### Remaining Screens
- [ ] Project Detail — team assignment inline editing (currently read-only in sidebar)
- [ ] Settings page (placeholder only)
- [ ] Notifications (placeholder only)

---

## Architecture Notes

### Auth Boundary (critical — do not regress)
- Azure AD tokens are NOT native Supabase JWTs
- `supabase.auth.getUser()` does NOT work with Azure AD tokens
- User identity: parse JWT payload directly (base64 decode, extract `oid`/`sub`)
- All writes go through Edge Functions using service_role key
- Reads use user JWT directly with RLS SELECT policies
- Edge Functions MUST have JWT verification OFF in Supabase dashboard

### Edge Functions
- `create-project` — JWT verify OFF ✅
- `update-project` — JWT verify OFF ✅
- `upsert-production` — JWT verify OFF ✅
- `project-proxy` — JWT verify OFF ✅ (handles insert, update, update_task, SP folder creation)

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/supabase.js` | Supabase client — `detectSessionInUrl: false`, `flowType: pkce` |
| `src/pages/AuthCallback.jsx` | PKCE callback — `onAuthStateChange` listener |
| `src/context/AuthContext.jsx` | Auth state, session, profile, role, division |
| `src/lib/sharepoint.js` | Graph API utilities |
| `src/hooks/useSharePoint.js` | SP folder hook |
| `supabase/functions/project-proxy/` | Master write proxy + SP folder creation |

---

## Additional Context
Full sprint conversation saved to Kane PC project folder (Claude project).
