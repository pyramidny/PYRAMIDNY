// src/lib/permissions.js
// =============================================================================
// PERMISSION POLICY  ── frontend mirror of project-proxy/index.ts ──
//
// Used to hide/show UI controls. The backend is the actual enforcer — this
// just keeps the UI honest so users don't see buttons that 403.
//
// To change policy: edit BOTH this file AND the POLICY block in
// supabase/functions/project-proxy/index.ts. Keep them in sync.
//
// ── AUDIBLE REFERENCE ────────────────────────────────────────────────────────
// To open a capability to more roles, add the role string to its array.
// Valid role strings: "admin" | "director_of_operations" | "project_manager" |
//   "assistant_pm" | "estimator" | "task_manager" | "sales_rep" |
//   "estimating_coordinator" | "purchasing_manager" | "billing_coordinator" |
//   "office_manager" | "field_crew"
// Use "*" to allow all authenticated users.
// =============================================================================

export const POLICY = {
  // Project lifecycle
  create_project:        ["admin"],
  update_project_fields: ["admin"],
  update_project_status: ["admin"],
  advance_stage:         ["admin"],
  delete_project:        ["admin"],
  backfill_project:      ["admin"],

  // Team / assignments
  assign_team:           ["admin"],

  // Task assignment — admin + Director of Operations
  // To also allow PMs: add "project_manager" to this array
  assign_task:           ["admin", "director_of_operations"],

  // Production checklist
  edit_production:       ["admin"],

  // Milestones
  edit_milestones:       ["admin"],

  // Tasks
  toggle_own_task:       ["*"],
  edit_any_task:         ["admin"],

  // Files / photos
  upload_file:           ["admin"],
  delete_file:           ["admin"],

  // Staff management
  manage_staff:          ["admin"],
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
  return (action) => can(action, role)
}

/**
 * Convenience helper — returns true if the current user is an admin.
 */
export function useIsAdmin() {
  const { profile } = useAuth()
  return profile?.role === 'admin'
}
