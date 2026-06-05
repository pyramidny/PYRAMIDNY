# Pyramid Restoration Staff Portal

Project management portal for Pyramid Restoration Specialists (NY). Tracks
projects across two divisions (Regular / IRA Rope Access) through six workflow
stages, with SharePoint document storage and live file sync.

**Live:** https://app.pyramidny.com
**Repo:** pyramidny/PYRAMIDNY (main)
**Supabase ref:** `izjaxmcdlsdkdliqjlei`  *(NOT DiamondMSP — see Security doc)*
**Stack:** Vite + React + Tailwind · Supabase · Azure AD PKCE · Netlify · Cloudflare DNS

---

## Source of truth — read these first

| Doc | What it covers |
|-----|----------------|
| `Pyramid_Portal_Project_Context.md` | Full current state, schema, deploy runbook |
| `SCHEMA.md` | All tables, triggers, enums, edge functions |
| `SECURITY_HARDENING.md` | Lockdown checklist + the DiamondMSP secret incident |
| `SOLVED_PROBLEMS.md` | PROBLEM / FIX / HAND-OFF archive |

This README is the orientation page. The Context doc is the live detail.

---

## Auth architecture (do not break)

Azure AD JWTs are Microsoft-signed. Supabase **cannot** verify them, so
PostgREST evaluates every request as the `anon` role. That single fact drives
the whole write design:

- **All writes go through the `project-proxy` Edge Function** using the
  `service_role` key. Never write to tables directly from the client.
- **All Edge Functions have "Verify JWT" OFF** at the gateway (Azure tokens
  would be rejected otherwise). CLI deploys must pass `--no-verify-jwt`.
- `supabase.auth.getSession()` / `getUser()` **return null** for Azure users.
  Read the token directly from
  `localStorage['sb-izjaxmcdlsdkdliqjlei-auth-token'].access_token`.
- The proxy authenticates the caller itself: it looks up the profile
  (azure_oid with email fallback) and gates every action through `POLICY`.

---

## Permission system

One capability map, mirrored in two places. **They must stay in sync.**

- Backend: `supabase/functions/project-proxy/index.ts` → `POLICY` constant
- Frontend: `src/lib/permissions.js` → `POLICY` constant + `useCanDo()` hook

To change a permission: edit the one string in both files, redeploy the proxy,
push the frontend. No schema migration needed.

---

## Edge Functions

| Function | Purpose | Verify JWT |
|----------|---------|------------|
| `project-proxy` | **All write operations** (single dispatch entry point) | OFF |
| `graph-webhook-receiver` | Receives SharePoint change notifications → `project_documents` | OFF |
| `ensure-graph-subscription` | Creates / renews the Graph subscription | OFF |

> The old standalone `create-project`, `update-project`, and
> `upsert-production` functions are **superseded by `project-proxy`**. Do not
> build on them.

---

## Deploy sequence (always this order)

1. SQL migration → Supabase SQL Editor
2. Edge Function → `supabase functions deploy <name> --no-verify-jwt --project-ref izjaxmcdlsdkdliqjlei`
3. Frontend → `git push` (Netlify auto-builds)

Edge Function deploys are **separate** from `git push`. A commit to
`supabase/functions/**` is source control only — it does not deploy.

CLI must be logged in as `william@pyramidny.com` (project owner). Other
accounts return 403.

---

## Basic git commands

```bash
git pull                      # get current before editing (multi-PC)
git add .
git commit -m "your message"
git push
```

---

## Key facts

- `division_type` enum: `regular`, `ira` only — cross-division users use NULL
- `task_status` enum uses `completed` (not `complete`)
- Project numbering: single `A#####` sequence for both divisions (Jorge confirmed)
- `SP_SITE_ID` secret must be compound: `hostname,siteCollectionGuid,webGuid`
- Tables: `project_tasks`, `staff_whitelist`, `staff_audit_log`,
  `workflow_task_templates`, `milestone_definitions` → `project_milestones`
