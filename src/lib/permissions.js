// src/lib/permissions.js
// =============================================================================
// PERMISSION POLICY  ── frontend mirror of project-proxy/index.ts ──
//
// Transcribed from Jorge's capability matrix (app.pdf, Sep 2026). Used to
// hide/show UI controls. The backend is the actual enforcer — this just keeps
// the UI honest so users don't see buttons that 403.
//
// To change policy: edit BOTH this file AND the POLICY block in
// supabase/functions/project-proxy/index.ts. Keep them in sync.
//
// ── ROLE VOCABULARY (Jorge's 8-role model, 12_role_model_jorge8.sql) ─────────
//   Jorge's name   →  role string
//   Admin          →  "admin"
//   Overseer       →  "overseer"
//   Director       →  "director_of_operations"
//   Task Manager   →  "task_manager"
//   PM             →  "project_manager"
//   PM Asst        →  "assistant_pm"
//   Estimator      →  "estimator"
//   Field Tech     →  "field_crew"
//
// Legacy job-title roles still readable on old rows but never assigned:
//   "sales_rep", "estimating_coordinator", "purchasing_manager",
//   "billing_coordinator", "office_manager", "tool_manager"
// They are deliberately absent from every array below — anyone still holding
// one has the capabilities of no role at all, which is the signal to remap them
// in Team Management. Do not add them back; remap the person instead.
//
// Use "*" to allow all authenticated users.
//
// ── ⚠ THE ◐ PROBLEM — READ BEFORE TRUSTING THIS FILE ────────────────────────
// Jorge's matrix marks several capabilities ◐ = "scoped to their division /
// assigned jobs", not a flat yes. The app has no project-visibility scoping
// yet — `division` is display-only and there is no "is this person on this
// job" predicate — so every ◐ below is currently enforced as a full ✓.
//
// Practical effect: a PM can edit ANY project's details, not just the ones
// they are assigned to. That is wider than Jorge signed off on. It is also
// strictly better than today's state, where the same people can do nothing at
// all. The capabilities carrying this debt are listed in SCOPED — when the
// visibility feature lands, that list is the work queue.
// =============================================================================

// Convenience groupings. Defined as constants so a role that should sit in
// several capabilities is added in one place instead of five.
const SENIOR = ["admin", "overseer", "director_of_operations"]
const NOT_FIELD = [...SENIOR, "task_manager", "project_manager",
                   "assistant_pm", "estimator"]

/**
 * Capabilities Jorge marked ◐ (scoped) that we currently grant unscoped.
 * Not read by any check — it exists so the shortcut is greppable from code
 * rather than living only in a doc nobody opens.
 */
export const SCOPED = [
  "update_project_fields",  // Director ◐, Task Manager ◐, PM ◐
  "advance_stage",          // Director ◐, PM ◐
  "assign_team",            // Director ◐, Task Manager ◐
  "assign_task",            // Director ◐, Task Manager ◐, PM ◐
  "edit_production",        // Director ◐, PM ◐
  "edit_milestones",        // Director ◐, PM ◐
  "create_client",          // Task Manager ◐, PM ◐  (Director is a full ✓)
  "edit_client",            // Task Manager ◐, PM ◐  (Director is a full ✓)
]

export const POLICY = {
  // ── Project lifecycle ─────────────────────────────────────────────────────
  // "Create a new project / bid" — a flat ✓ for the top four, no scoping.
  create_project:        [...SENIOR, "task_manager"],
  // "Edit project details" — Overseer is explicitly — here despite outranking
  // Task Manager elsewhere. Overseers watch; they don't edit.
  update_project_fields: ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  // Status rides the same proxy action as fields, so it carries the same list.
  update_project_status: ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  // "Advance or change project stage" — Task Manager is — on this row.
  advance_stage:         ["admin", "director_of_operations", "project_manager"],
  // Not in the matrix. Destructive, so it stays where the 🔒 rows are.
  delete_project:        ["admin"],
  backfill_project:      ["admin"],

  // ── Team / assignments ────────────────────────────────────────────────────
  // "Assign team members to a project" — PM is — here. A PM does not choose
  // who else is on the job.
  assign_team:           ["admin", "director_of_operations", "task_manager"],

  // ── Tasks ─────────────────────────────────────────────────────────────────
  // "Assign a task to a person". Note Overseer is — and PM is ◐: the previous
  // code had this exactly inverted.
  assign_task:           ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  // "Complete their own assigned tasks" — every role, including Field Tech.
  toggle_own_task:       ["*"],
  // ⚠ NOT IN JORGE'S MATRIX. The matrix has "complete your own" and "assign to
  // a person" but no row for completing someone else's task. Aligned with
  // assign_task on the reading that whoever hands out a task can also close it
  // out. Confirm with Jorge — this is the one capability below that is an
  // inference rather than a transcription.
  edit_any_task:         ["admin", "director_of_operations", "task_manager",
                          "project_manager"],

  // ── Production / milestones ───────────────────────────────────────────────
  // One row in the matrix covers both.
  edit_production:       ["admin", "director_of_operations", "project_manager"],
  edit_milestones:       ["admin", "director_of_operations", "project_manager"],

  // ── Files / photos ────────────────────────────────────────────────────────
  upload_file:           ["*"],          // ✓ on every role incl. Field Tech
  delete_file:           ["admin"],      // 🔒 admin-only by design

  // ── Staff management ──────────────────────────────────────────────────────
  manage_staff:          ["admin"],      // 🔒

  // ── Clients / sites / contacts ────────────────────────────────────────────
  // "View client list" is ✓ on every role except Field Tech, so it cannot be "*".
  // ⚠ ENFORCED IN THE UI ONLY. ClientList.jsx reads `clients` straight from
  // supabase-js, not through the proxy, so the real gate is that table's RLS
  // policy — not this array. Hiding the nav item stops the honest path; it does
  // not stop a Field Tech who opens the console.
  view_clients:          NOT_FIELD,
  // "Create or edit a client" — Director full ✓; Task Manager and PM ◐.
  create_client:         ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  edit_client:           ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  delete_client:         ["admin"],      // 🔒 "Delete a client / move a site"
  move_site:             ["admin"],      // 🔒 same row
  backfill_folders:      ["admin"],      // not in matrix; maintenance op
}

/**
 * Pure permission check — no React. Use this in non-component code (utils,
 * route guards, etc.).
 */
export function can(action, role) {
  const allowed = POLICY[action]
  if (!allowed) return false
  if (allowed.includes('*')) return true
  if (!role) return false
  return allowed.includes(role)
}

// =============================================================================
// ADD-ON HATS
// =============================================================================
// Tool and Billing layer on ANY base role, so they are checked separately from
// POLICY. Both are ranked ladders, not sets — 'admin' implies everything
// 'tech'/'view' can do — so compare by rank, never by equality. Writing
// `tool_access === 'admin'` at a call site silently locks out the tier above.
//
// Admin is a superuser for both hats: the base role outranks any hat setting,
// which is why an Admin with tool_access 'none' can still work Tool Control.
//
// TOOL TIERS, per Jorge's Tool Control table:
//   (any role) view catalog · check a tool out / in
//   tech       + log maintenance · print QR tags · run utilisation reports
//   admin      + enroll · edit details · retire
// Note the first row: basic tool use is open to EVERY role, hat or not. Do not
// gate the Tool Control page itself on the hat.

const TOOL_RANK    = { none: 0, tech: 1, admin: 2 }
const BILLING_RANK = { none: 0, view: 1, admin: 2 }

/**
 * Does this profile hold the Tool hat at `tier` or above?
 *   canTool(profile, 'tech')  → maintenance, QR tags, reports
 *   canTool(profile, 'admin') → enroll, edit, retire
 * Viewing the catalog and checking tools in/out need no hat at all.
 */
export function canTool(profile, tier = 'tech') {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return (TOOL_RANK[profile.tool_access] ?? 0) >= (TOOL_RANK[tier] ?? 99)
}

/**
 * Does this profile hold the Billing hat at `tier` or above?
 *   canBill(profile, 'view')  → dashboard, financials, run/export reports
 *   canBill(profile, 'admin') → CSV import, invoices/pay reqs, void, settings
 *
 * NOTE: nothing consumes this yet — the billing screens are unbuilt, so the hat
 * is seeded-but-inert. Gate them on this when they land rather than reading
 * `billing_access` directly.
 */
export function canBill(profile, tier = 'view') {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return (BILLING_RANK[profile.billing_access] ?? 0) >= (BILLING_RANK[tier] ?? 99)
}

// =============================================================================
// React bindings
// =============================================================================

import { useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'

/**
 * React hook returning a `canDo(action)` predicate bound to the current user.
 *
 * Usage:
 *   const canDo = useCanDo()
 *   {canDo('assign_task') && <AssignDropdown />}
 */
export function useCanDo() {
  const { profile } = useAuth()
  const role = profile?.role
  // MUST be memoised on `role`. Returning a fresh arrow each render makes this
  // unsafe in any useEffect/useCallback dependency array — the identity changes
  // every render, the effect re-fires, state updates, and you get an infinite
  // render loop that hammers the API until the browser runs out of sockets.
  return useCallback((action) => can(action, role), [role])
}

/**
 * Hook form of canTool / canBill. Memoised on the same reasoning as useCanDo —
 * these end up in dependency arrays too.
 */
export function useCanTool() {
  const { profile } = useAuth()
  const role = profile?.role
  const tool = profile?.tool_access
  return useCallback((tier) => canTool({ role, tool_access: tool }, tier), [role, tool])
}

export function useCanBill() {
  const { profile } = useAuth()
  const role = profile?.role
  const billing = profile?.billing_access
  return useCallback((tier) => canBill({ role, billing_access: billing }, tier), [role, billing])
}

/**
 * Convenience helper — returns true if the current user is an admin.
 */
export function useIsAdmin() {
  const { profile } = useAuth()
  return profile?.role === 'admin'
}
