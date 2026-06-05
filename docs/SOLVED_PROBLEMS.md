# Solved Problems Archive — Pyramid Restoration Staff Portal

Append new entries to the top. Format: SOLVED / PROBLEM / FIX / HAND-OFF.

---

## SOLVED — Microsoft secrets loaded into the wrong Supabase project
*Date: May 2026*

**PROBLEM**
The four Microsoft Graph secrets (`MS_TENANT_ID`, `MS_CLIENT_ID`,
`MS_CLIENT_SECRET`, `WEBHOOK_CLIENT_STATE_SECRET`) were added to the DiamondMSP
project (`meowqbvmmqynblzxbnnw`) instead of Pyramid (`izjaxmcdlsdkdliqjlei`).
Caught by checking the dashboard breadcrumb. Inert where they sat, and a client
data-isolation risk: DiamondMSP access would have inherited reach into Pyramid's
SharePoint.

**FIX**
Deleted all four from DiamondMSP. Re-added them to the Pyramid project, which is
where the webhook receiver Edge Function reads them. Established the standing
rule: one client's credentials never live in another project; always confirm the
project breadcrumb before adding a secret.

**HAND-OFF**
Captured as item #1 in `SECURITY_HARDENING.md`. No code change — configuration
only. Webhook receiver depends on these living in Pyramid.

---

## SOLVED — Azure AD writes returning 401 through the proxy
*Date: April 2026*

**PROBLEM**
Writes failed with 401. Two layered causes: (1) `project-proxy` and
`upsert-production` still had Verify JWT ON at the gateway, so Azure tokens were
rejected before function code ran; (2) frontend used `supabase.auth.getSession()`
which returns null for Azure users, sending an empty Bearer token.

**FIX**
Turned Verify JWT OFF for all Edge Functions in the dashboard. Switched token
reads to direct localStorage (`sb-izjaxmcdlsdkdliqjlei-auth-token`).

**HAND-OFF**
`getSession()` still lingers in the stale reference copies of `NewProject.jsx`
and `ProjectDetail.jsx` — the live versions are fixed. If those reference files
are ever re-introduced, re-apply the localStorage pattern.
