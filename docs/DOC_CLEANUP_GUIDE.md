# Doc Cleanup Guide — what to remove, keep, consolidate

The project workspace has drifted. Here's the triage so the docs match the live
app and there's less for either of us to wade through.

## Remove (stale / superseded)

| File | Why |
|------|-----|
| `README.md` (April 5 version) | Describes the 3 standalone Edge Functions as the write path. Wrong — `project-proxy` replaced them. **Replace with the new README in this bundle.** |
| `index.ts` (upsert-production) reference copies | Superseded by `project-proxy`. Keep only if you want a historical reference; not part of the live write path. |

## Keep as-is

| File | Why |
|------|-----|
| `Pyramid_Staff_Roles_Approval.docx` | Jorge's role doc — still valid |
| `AuthCallback.jsx`, `supabase.js`, `ProjectList.jsx` | Reference copies, accurate enough |
| `Pyramid_Portal_Project_Context.md` | The real source of truth |

## Flag (carry the old getSession bug — not the live versions)

| File | Note |
|------|------|
| `NewProject.jsx`, `ProjectDetail.jsx` | These reference copies still call `supabase.auth.getSession()`. The **live** repo versions are fixed. Don't treat these as current. |

## Consolidate (the fix going forward)

Standardize on four living docs at the repo root:

1. **`README.md`** — orientation (new version in this bundle)
2. **`Pyramid_Portal_Project_Context.md`** — full current state + runbook
3. **`SCHEMA.md`** — tables/triggers/enums reference
4. **`SECURITY_HARDENING.md`** — lockdown checklist (in this bundle)

Plus **`SOLVED_PROBLEMS.md`** as the running archive (in this bundle) — fold any
older one-off PROBLEM/FIX markdown files in the repo root into it, then delete
the loose ones.

## Drop-in commands

```bash
# from repo root, after copying the new files in
git add README.md SECURITY_HARDENING.md SOLVED_PROBLEMS.md
git rm <old-loose-fix-notes>.md      # whatever you fold in
git commit -m "docs: refresh README, add hardening + solved archive, retire stale notes"
git push
```
