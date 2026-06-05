# Security Hardening — Pyramid Restoration Staff Portal

Lockdown checklist before wider rollout. Grounded in the real incident below
plus the known architecture. Work top to bottom; check each box.

---

## The incident this guards against (DiamondMSP secret bleed)

**What happened:** The four Microsoft secrets (`MS_TENANT_ID`, `MS_CLIENT_ID`,
`MS_CLIENT_SECRET`, `WEBHOOK_CLIENT_STATE_SECRET`) were added to the
**DiamondMSP** Supabase project (`meowqbvmmqynblzxbnnw`) instead of **Pyramid**
(`izjaxmcdlsdkdliqjlei`).

**Why it matters:** Pyramid's Microsoft credentials living in Kane PC's internal
MSP project means anyone with DiamondMSP access (e.g. Stef or Rich later) would
inherit reach into Pyramid's SharePoint via the Graph API. Client credential
isolation broken.

**The rule:** Every Pyramid secret lives in `izjaxmcdlsdkdliqjlei` and nowhere
else. One client's credentials never sit in another project.

---

## 1. Secret location & isolation (CRITICAL)

- [ ] Confirm all 4 MS secrets live in **Pyramid** project only
- [ ] Confirm they are **deleted** from DiamondMSP
- [ ] `SP_SITE_ID`, `SUPABASE_SERVICE_ROLE_KEY` present in Pyramid only
- [ ] No secret value pasted into chat, commit, or doc (Client ID is public; Client Secret is NOT)
- [ ] Verify in dashboard URL the breadcrumb reads the Pyramid project before adding any secret

## 2. Service role key (CRITICAL)

- [ ] `service_role` key NEVER appears in frontend code or Netlify env vars
- [ ] Only Edge Functions read it (via `Deno.env.get`)
- [ ] Frontend uses the **anon** key only (`VITE_SUPABASE_ANON_KEY`)

## 3. Edge Function auth model

Because Verify JWT is OFF, the gateway does not authenticate anyone — the
function must do it itself. Confirm:

- [ ] `project-proxy` looks up the caller profile and rejects unknown callers (403)
- [ ] Every write action is gated by `POLICY` / `canDo()` — no ungated action
- [ ] `graph-webhook-receiver` validates `WEBHOOK_CLIENT_STATE_SECRET` on every
      call (it is a public, unauthenticated endpoint — clientState is the only
      thing stopping a forged notification)

## 4. RLS cleanup (open item)

- [ ] Remove the temporary permissive policy on `projects` (`with check (true)`).
      It predates the proxy and is now dead weight / a write hole.
- [ ] Confirm lookup tables that the anon client reads have SELECT-only `USING (true)`
      policies — no anon INSERT/UPDATE/DELETE anywhere

## 5. Least privilege on Graph

- [ ] App registration holds only `Files.ReadWrite.All` + `Sites.ReadWrite.All`
- [ ] No unused Graph permissions granted
- [ ] Calendar a Client Secret rotation reminder (note the expiry date)

## 6. Repo hygiene

- [ ] `.env`, `.zips/`, and any secret-bearing files are in `.gitignore`
- [ ] No secrets in git history (search before going public/sharing repo)
- [ ] `export-to-claude.ps1` strips secrets before zipping (it does — confirm)

## 7. Access & accounts

- [ ] Supabase project owner = `william@pyramidny.com` only for deploys
- [ ] Staff get portal access via `staff_whitelist` (invite pattern), not direct seeding
- [ ] `staff_audit_log` is capturing role changes / deactivations

---

## Two-minute verification queries (run in Pyramid SQL Editor)

```sql
-- Any leftover permissive write policies on projects?
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'projects';

-- Any anon-writable tables? (should return nothing alarming)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND cmd <> 'SELECT'
ORDER BY tablename;
```

---

*Maintainer: Bill Kane · app@pyramidny.com · Kane PC*
