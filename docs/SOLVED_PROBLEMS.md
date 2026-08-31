# Solved Problems Archive — Pyramid Restoration Staff Portal

Append new entries to the top. Format: SOLVED / PROBLEM / FIX / HAND-OFF.

---

## SOLVED — Jorge's 8 roles wouldn't fit the 12-value user_role enum
*Date: 2026-08-31 — full write-up: `docs/SOLVED_role_model_and_access_hats.md`*

**PROBLEM**
Jorge's permission matrix defines 8 base roles plus two add-on "hats" (Tool,
Billing). The `user_role` enum held 12 job-title roles; only `admin`,
`task_manager` and `estimator` matched by name. Writing `pm` or `overseer`
returned `Invalid role` from the project-proxy `VALID_ROLES` check. Tool access
was a role (`tool_manager`), not a hat, so "PM who also runs the tool crib" was
unexpressible. Billing had no representation at all.

**FIX**
Stored value and displayed name are not the same thing — `TeamManagement.jsx`
already mapped `value` → `label`. Jorge's names went on the labels; the legacy
identifiers stayed as the values. Only `overseer` was genuinely new. The six
roles his model folds into "base + hat" moved to a "Retired" `<optgroup>` rather
than being removed, so current holders don't render as a blank `<select>`.
Hats added as `text NOT NULL DEFAULT 'none'` + CHECK on both `profiles` and
`staff_whitelist`, tool hat backfilled from `tool_manager` before any base role
moved. `12_role_model_jorge8.sql` + `13_seed_access_matrix.sql`.

Division "Both" needed no migration: `Sidebar.jsx` had been rendering
`division: null` as "All Divisions" all along. Do NOT add a literal `'both'` —
the division type is shared with `projects`, where a project must be Regular or
IRA and never both.

**HAND-OFF**
31 staff loaded, verified `admins 6 · billing_admins 3 · tool_hats 3`. Deploy
order is SQL → edge function → frontend and is not optional: `update_profile`
ignores unknown keys, so a frontend deployed first saves hats with a 200 and
changes nothing — silent, not loud. Note `profiles` and `staff_whitelist` count
differently; 11 staff have no profile row yet, so a `profiles` query reads 6
admins where the Team screen reads 7.

Still open: the POLICY rewrite (this changed what people *are*, not what they
can *do* — `permissions.js` and its proxy mirror are still `["admin"]` on most
actions), Luis Reyes holding Admin while absent from the matrix, and two email
mismatches (Victor Ortiz, Jesus Cruz) that the Team screen cannot fix because
email is the whitelist key.

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
