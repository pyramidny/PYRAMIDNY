// src/lib/permissions.js
// =============================================================================
// PERMISSION POLICY  ── frontend mirror of project-proxy/index.ts ──
//
// Used to hide/show UI controls. The backend is the actual enforcer — this
// just keeps the UI honest so users don't see buttons that 403.
//
// To change policy: edit BOTH this file AND the POLICY block in
// supabase/functions/project-proxy/index.ts. Keep them in sync.
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
 *   {canDo('advance_stage') && <button>Advance Stage</button>}
 */
export function useCanDo() {
  const { profile } = useAuth()
  const role = profile?.role
  return (action) => can(action, role)
}

/**
 * Convenience helper — returns true if the current user is an admin.
 * Useful when you want a single short check at the top of a component.
 */
export function useIsAdmin() {
  const { profile } = useAuth()
  return profile?.role === 'admin'
}
