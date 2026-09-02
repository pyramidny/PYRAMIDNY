import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SP_SITE_ID = Deno.env.get("SP_SITE_ID") ?? "";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// App-only (client credentials) Graph auth. See getGraphToken() below.
// Reads the existing MS_* secrets (set May 2026 for the Graph webhook work).
// GRAPH_* names are accepted as an alias so either naming works.
const GRAPH_TENANT_ID =
  Deno.env.get("MS_TENANT_ID") ?? Deno.env.get("GRAPH_TENANT_ID") ?? "";
const GRAPH_CLIENT_ID =
  Deno.env.get("MS_CLIENT_ID") ?? Deno.env.get("GRAPH_CLIENT_ID") ?? "";
const GRAPH_CLIENT_SECRET =
  Deno.env.get("MS_CLIENT_SECRET") ?? Deno.env.get("GRAPH_CLIENT_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// APP-ONLY MICROSOFT GRAPH TOKEN
// ============================================================================
// Replaces the user's `provider_token` for every SharePoint call.
//
// WHY: Supabase captures the Microsoft Graph delegated token at OAuth login and
// stores it in localStorage, but never refreshes it. Graph access tokens live
// ~1 hour, so the entire SharePoint layer only worked for about an hour after a
// fresh sign-in. Staff stay signed in for days, so in practice folder creation
// silently no-op'd and uploads returned "providerToken required".
//
// This uses the PYRAMID COMMAND CENTER app registration (Application
// permissions: Sites.ReadWrite.All + Files.ReadWrite.All, admin consented).
// No user token is involved, so it works for any user at any time, and for
// unattended jobs like the file-server migration.
//
// Tokens are cached in public.graph_token_cache and reused until 5 minutes
// before expiry.

let memoToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string | null> {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) return null;

  const now = Date.now();
  const SKEW_MS = 5 * 60 * 1000; // refresh 5 min early

  // 1. In-memory (survives within a warm isolate)
  if (memoToken && memoToken.expiresAt - SKEW_MS > now) return memoToken.token;

  // 2. Shared DB cache (survives cold starts and is shared across isolates)
  try {
    const { data } = await supabase
      .from("graph_token_cache")
      .select("access_token, expires_at")
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.access_token && data?.expires_at) {
      const exp = new Date(data.expires_at).getTime();
      if (exp - SKEW_MS > now) {
        memoToken = { token: data.access_token, expiresAt: exp };
        return data.access_token;
      }
    }
  } catch (_) {
    // Cache read failure is not fatal — fall through and mint a fresh token.
  }

  // 3. Mint a new one
  try {
    const form = new URLSearchParams({
      client_id: GRAPH_CLIENT_ID,
      client_secret: GRAPH_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );

    if (!res.ok) {
      console.error("Graph token request failed:", res.status, await res.text());
      return null;
    }

    const tok = await res.json();
    if (!tok.access_token) return null;

    const expiresAt = now + ((tok.expires_in ?? 3600) * 1000);
    memoToken = { token: tok.access_token, expiresAt };

    // Replace the cache row. Best effort — never block on it.
    try {
      await supabase.from("graph_token_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("graph_token_cache").insert({
        access_token: tok.access_token,
        expires_at: new Date(expiresAt).toISOString(),
      });
    } catch (_) { /* ignore */ }

    return tok.access_token;
  } catch (err) {
    console.error("Graph token error:", err);
    return null;
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// SharePoint subfolder structure per project
// ============================================================================
// Three top-level parents per project (confirmed by Jorge, Jun 2026).
// "3. Photos" is intentionally flat — no child folders.
const SP_SUBFOLDER_TREE: Record<string, string[]> = {
  "1. Estimating Phase": [
    "Bid Invite & Emails",
    "Bid Submission & Pricing Template",
    "Drawings",
    "Interview Package",
    "Specifications & Notice to Bidders",
    "Vendor Quotes",
    "Walkthrough Photos & Notes",
  ],
  "2. Production": [
    "CCI or Tax Exempt",
    "Change Orders & Proposal",
    "Close Outs",
    "Contract & Riders",
    "Drawings",
    "Equipment & Material Orders",
    "Field Reports & Meeting Minutes",
    "Incident Reports",
    "Informational Packet",
    "Insurance & Indemnity",
    "Job Cost",
    "Job Site Binder",
    "Pay Reqs",
    "Permits",
    "Subcontractors",
    "Submittals",
    "Timelines & Schedules",
    "Transfer Package",
    "Vendor & Invoices",
  ],
  // Kept as subfolders so the app's Photos tab keeps Before/After separation.
  // If Jorge wants a flat Photos folder, set this back to [].
  "3. Photos": [
    "Before",
    "Progress",
    "After",
    "Permits Posted",
    "Damage",
    "Other",
  ],
};

// Valid user_role values (from DB enum) — used to validate role updates.
// The first 8 are Jorge's model (shown in the UI under his own names — see the
// ROLES table in TeamManagement.jsx); the rest are legacy job-title roles his
// model folds into "base role + hat". Still accepted so existing holders can be
// read and re-saved, but they are no longer offered for new assignments.
const VALID_ROLES = [
  "admin", "overseer", "director_of_operations", "task_manager",
  "project_manager", "assistant_pm", "estimator", "field_crew",
  // legacy — being phased out
  "sales_rep", "estimating_coordinator", "purchasing_manager",
  "billing_coordinator", "office_manager", "tool_manager",
];

// Add-on "hats". Independent of base role, and mirrored on both profiles and
// staff_whitelist. Kept in lockstep with the CHECK constraints in
// 12_role_model_jorge8.sql — change one, change the other.
const VALID_TOOL_ACCESS = ["none", "tech", "admin"];
const VALID_BILLING_ACCESS = ["none", "view", "admin"];

// ============================================================================
// PERMISSION POLICY  ── mirror of src/lib/permissions.js ──
// ============================================================================
// THIS is the enforcer. permissions.js only hides buttons; anyone can call this
// function directly with a valid JWT, so every mutating action must run through
// `deny()` below. Change a capability here and in permissions.js together —
// they are a deliberate mirror and drift between them is a security hole, not a
// cosmetic bug.
//
// Legacy job-title roles (sales_rep, office_manager, tool_manager, …) appear in
// no array on purpose: the 8-role model retired them, so a holder has the
// capabilities of no role until they are remapped in Team Management.

const SENIOR = ["admin", "overseer", "director_of_operations"];
const NOT_FIELD = [...SENIOR, "task_manager", "project_manager",
                   "assistant_pm", "estimator"];

// ⚠ Capabilities Jorge marked ◐ ("scoped to their division / assigned jobs")
// are granted UNSCOPED here, because the app has no project-visibility
// predicate yet. See the SCOPED list in permissions.js for the work queue.
const POLICY: Record<string, string[]> = {
  create_project:        [...SENIOR, "task_manager"],
  update_project_fields: ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  update_project_status: ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  advance_stage:         ["admin", "director_of_operations", "project_manager"],
  delete_project:        ["admin"],
  backfill_project:      ["admin"],

  assign_team:           ["admin", "director_of_operations", "task_manager"],

  assign_task:           ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  toggle_own_task:       ["*"],
  // Not in Jorge's matrix — inferred to match assign_task. See permissions.js.
  edit_any_task:         ["admin", "director_of_operations", "task_manager",
                          "project_manager"],

  edit_production:       ["admin", "director_of_operations", "project_manager"],
  edit_milestones:       ["admin", "director_of_operations", "project_manager"],

  upload_file:           ["*"],
  delete_file:           ["admin"],

  manage_staff:          ["admin"],

  // "View client list" is ✓ on every role except Field Tech, so not "*".
  // ⚠ Client reads bypass this function entirely (ClientList.jsx queries
  // supabase-js directly), so this entry documents intent — the enforcement
  // that matters is the RLS policy on `clients`.
  view_clients:          NOT_FIELD,
  create_client:         ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  edit_client:           ["admin", "director_of_operations", "task_manager",
                          "project_manager"],
  delete_client:         ["admin"],
  move_site:             ["admin"],
  backfill_folders:      ["admin"],
};

type Caller = {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  tool_access: string;
  billing_access: string;
} | null;

// Ranked ladders — 'admin' implies 'tech'/'view'. Compare by rank, never by
// equality, or the tier above silently loses access.
const TOOL_RANK: Record<string, number> = { none: 0, tech: 1, admin: 2 };
const BILLING_RANK: Record<string, number> = { none: 0, view: 1, admin: 2 };

function hasTool(caller: Caller, tier = "tech"): caller is NonNullable<Caller> {
  if (!caller || !caller.is_active) return false;
  if (caller.role === "admin") return true;
  return (TOOL_RANK[caller.tool_access] ?? 0) >= (TOOL_RANK[tier] ?? 99);
}

function hasBilling(caller: Caller, tier = "view"): caller is NonNullable<Caller> {
  if (!caller || !caller.is_active) return false;
  if (caller.role === "admin") return true;
  return (BILLING_RANK[caller.billing_access] ?? 0) >= (BILLING_RANK[tier] ?? 99);
}

function allow(action: string, caller: Caller): caller is NonNullable<Caller> {
  const allowed = POLICY[action];
  if (!allowed) return false;              // unknown capability = closed
  if (!caller || !caller.is_active) return false;
  if (allowed.includes("*")) return true;
  return allowed.includes(caller.role);
}

// ============================================================================
// Helpers
// ============================================================================

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = parts[1].length % 4;
    const b64 = parts[1] + (pad ? "=".repeat(4 - pad) : "");
    return JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

function sanitizeFolderName(projectNumber: string, address: string): string {
  return (projectNumber + "_" + address)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
    .substring(0, 240);
}

// Folder name for a CLIENT or a SITE.
//
// SharePoint caps the full decoded URL at 400 characters, and every space is
// URL-encoded to %20 (3 chars). With Client/Site/Project nesting plus a
// subfolder plus a filename, long names eat the budget fast — so names are
// slugged (spaces to underscores) and capped. 28 is the agreed cap for both
// tiers; the project tier uses sanitizeFolderName() and its own cap.
function sanitizeEntityName(name: string, cap = 28): string {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\b(c\/o|C\/O)\b/g, "")
    .replace(/[,&'".]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, cap)
    .replace(/_$/, "") || "Unnamed";
}

// Server-side MOVE of a driveItem to a new parent. This is a real move, not a
// copy — instant, and driveItem IDs, permissions and version history all
// survive. It is what makes "this building changed management company" a
// one-call operation instead of a re-upload.
//
// Only possible because folders are addressed by ID. A path-addressed folder
// could not be moved without rewriting every stored path.
async function moveGraphItem(
  token: string,
  itemId: string,
  newParentId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${itemId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ parentReference: { id: newParentId } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Graph move failed:", err?.error?.message ?? res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Graph move threw:", e);
    return false;
  }
}

async function createGraphFolder(
  token: string,
  name: string,
  parentId: string | null,
): Promise<{ id: string; webUrl: string } | null> {
  const url = parentId
    ? `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${parentId}/children`
    : `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/root/children`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`SP folder "${name}" failed:`, err?.error?.message ?? res.status);
      return null;
    }
    const d = await res.json();
    return { id: d.id, webUrl: d.webUrl };
  } catch (e) {
    console.error(`SP folder "${name}" threw:`, e);
    return null;
  }
}

async function createProjectFolderTree(
  token: string,
  rootName: string,
): Promise<{ id: string; webUrl: string; subfolders: Record<string, string> } | null> {
  if (!SP_SITE_ID) { console.warn("SP_SITE_ID not set"); return null; }

  const root = await createGraphFolder(token, rootName, null);
  if (!root) return null;

  const subfolders: Record<string, string> = {};

  for (const [topLevel, children] of Object.entries(SP_SUBFOLDER_TREE)) {
    const top = await createGraphFolder(token, topLevel, root.id);
    if (!top) continue;
    subfolders[topLevel] = top.id;
    for (const child of children) {
      const sub = await createGraphFolder(token, child, top.id);
      if (sub) subfolders[`${topLevel}/${child}`] = sub.id;
    }
  }

  return { id: root.id, webUrl: root.webUrl, subfolders };
}

async function seedTasksFromTemplates(
  projectId: string,
  division: string,
  roleMap: { pm_id?: string | null; assistant_pm_id?: string | null; estimator_id?: string | null },
): Promise<number> {
  const { data: templates, error } = await supabase
    .from("workflow_task_templates")
    .select("*")
    .eq("is_active", true)
    .or(`division.eq.${division},division.is.null`)
    .order("stage_number")
    .order("sort_order");

  if (error || !templates || templates.length === 0) {
    console.error("Template fetch failed:", error?.message);
    return 0;
  }

  const rows = templates.map((t) => {
    let assigned_to_id: string | null = null;
    if (t.assigned_role === "project_manager") assigned_to_id = roleMap.pm_id ?? null;
    if (t.assigned_role === "assistant_pm")    assigned_to_id = roleMap.assistant_pm_id ?? null;
    if (t.assigned_role === "estimator")       assigned_to_id = roleMap.estimator_id ?? null;

    return {
      project_id: projectId,
      template_id: t.id,
      task_name: t.task_name,
      stage_number: t.stage_number,
      assigned_role: t.assigned_role,
      assigned_to_id,
      status: "pending",
      is_recurring: t.is_recurring ?? false,
      recurrence_type: t.recurrence_type ?? "none",
      recurrence_day_of_week: t.recurrence_day_of_week,
    };
  });

  const { error: insErr } = await supabase.from("project_tasks").insert(rows);
  if (insErr) {
    console.error("Task seed failed:", insErr.message);
    return 0;
  }
  return rows.length;
}

// Write to staff_audit_log — best-effort, never fails the parent operation
async function writeAudit(
  email: string,
  action: string,
  changedBy: string | null,
  oldValues: unknown,
  newValues: unknown,
  notes?: string,
) {
  try {
    await supabase.from("staff_audit_log").insert({
      email,
      action,
      changed_by: changedBy,
      old_values: oldValues ?? null,
      new_values: newValues ?? null,
      notes: notes ?? null,
    });
  } catch (e) {
    console.error("Audit write failed:", e);
  }
}

// Look up the caller's profile — try azure_oid first, fall back to email from JWT.
// Seed admin profiles were inserted manually and don't have azure_oid populated
// until their first login. This fallback unblocks them AND backfills azure_oid
// so subsequent calls hit the fast path.
async function lookupCallerProfile(userId: string, jwtPayload: Record<string, unknown>) {
  // Try azure_oid first (fast path for users whose profile was created by the trigger)
  const { data: byOid } = await supabase
    .from("profiles")
    .select("id, email, role, is_active, azure_oid, tool_access, billing_access")
    .eq("azure_oid", userId)
    .maybeSingle();
  if (byOid) return byOid;

  // Fallback: look up by email claim from the JWT
  const email = (jwtPayload.email
                 ?? jwtPayload.preferred_username
                 ?? jwtPayload.upn
                 ?? jwtPayload.unique_name) as string | undefined;
  if (!email) return null;

  const normalizedEmail = String(email).toLowerCase().trim();
  const { data: byEmail } = await supabase
    .from("profiles")
    .select("id, email, role, is_active, azure_oid, tool_access, billing_access")
    .ilike("email", normalizedEmail)
    .maybeSingle();
  if (!byEmail) return null;

  // Backfill azure_oid for next time
  if (!byEmail.azure_oid) {
    await supabase.from("profiles")
      .update({ azure_oid: userId, updated_at: new Date().toISOString() })
      .eq("id", byEmail.id);
    byEmail.azure_oid = userId;
  }

  return byEmail;
}

// ============================================================================
// Main handler
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "No authorization header" }, 401);

    const payload = parseJwtPayload(jwt);
    if (!payload) return json({ error: "Invalid token" }, 401);

    const userId = (payload.oid ?? payload.sub) as string | undefined;
    if (!userId) return json({ error: "No user identity in token" }, 401);

    const body = await req.json();
    const {
      action, project, projectId, id, updates, taskId, milestoneId,
      providerToken: callerProviderToken,
    } = body;

    // Every SharePoint call below uses `providerToken`. It now resolves to the
    // app-only token first and only falls back to the caller's (expiring)
    // provider_token if app-only credentials are not configured. This keeps all
    // existing call sites unchanged while removing the 1-hour expiry failure.
    const providerToken = (await getGraphToken()) ?? callerProviderToken ?? null;

    // ------------------------------------------------------------------------
    // HEALTH CHECK — used by New Project / New Client forms to warn up front
    // ------------------------------------------------------------------------
    if (action === "graph_health") {
      // client_id is a public identifier, not a secret — returned so we can
      // confirm which app registration is actually being used.
      const which = {
        client_id: GRAPH_CLIENT_ID || null,
        tenant_id: GRAPH_TENANT_ID || null,
        secret_present: !!GRAPH_CLIENT_SECRET,
        site_id_present: !!SP_SITE_ID,
      };
      const t = await getGraphToken();
      if (!t) {
        return json({
          ok: false,
          reason: "no_token",
          message: "Could not obtain a Microsoft Graph token. Check MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET.",
          ...which,
        });
      }
      try {
        const probe = await fetch(`${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/root`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (!probe.ok) {
          return json({
            ok: false,
            reason: "graph_error",
            status: probe.status,
            detail: (await probe.text()).slice(0, 400),
            message: "Graph token is valid but the SharePoint drive is unreachable.",
            ...which,
          });
        }
        return json({ ok: true, mode: "app_only", ...which });
      } catch (err) {
        return json({ ok: false, reason: "network", message: String(err), ...which });
      }
    }

    // ------------------------------------------------------------------------
    // INSERT PROJECT
    // ------------------------------------------------------------------------
    if (action === "insert") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("create_project", caller)) {
        return json({ error: "Not authorized to create projects" }, 403);
      }
      const { data: newProject, error: insertErr } = await supabase
        .from("projects")
        .insert({ ...project, created_by: userId })
        .select()
        .single();
      if (insertErr) return json({ error: insertErr.message }, 400);
      if (!newProject) return json({ error: "Insert returned no row" }, 500);

      const taskCount = await seedTasksFromTemplates(
        newProject.id, newProject.division,
        {
          pm_id: newProject.pm_id,
          assistant_pm_id: newProject.assistant_pm_id,
          estimator_id: newProject.estimator_id,
        },
      );

      await supabase.from("project_production")
        .insert({ project_id: newProject.id, pm_id: newProject.pm_id ?? null });

      // ---- SharePoint provisioning -----------------------------------------
      // The project row is already committed at this point. The DB is
      // authoritative: if SharePoint fails we do NOT roll back the project, we
      // report it. `sharepoint_folder_id IS NULL` is the signal that a project
      // still needs folders, and the `backfill_project` action re-runs this.
      //
      // Previously this was a bare `if (providerToken) { ... }` with no else,
      // so a missing/expired token silently produced a folderless project that
      // only surfaced later as an upload error.
      let spResult = null;
      let spWarning: string | null = null;

      if (!providerToken) {
        spWarning = "SharePoint folders were not created: no Graph token available. " +
                    "Use 'Create folders' on the project to retry.";
        console.error("Folder provisioning skipped — no Graph token", newProject.project_number);
      } else {
        const folderName = sanitizeFolderName(
          newProject.project_number ?? String(newProject.id),
          newProject.project_address ?? "No_Address",
        );
        try {
          spResult = await createProjectFolderTree(providerToken, folderName);
        } catch (err) {
          console.error("Folder provisioning threw", newProject.project_number, err);
        }

        if (spResult) {
          await supabase.from("projects").update({
            sharepoint_folder_id: spResult.id,
            sharepoint_folder_url: spResult.webUrl,
          }).eq("id", newProject.id);
          Object.assign(newProject, {
            sharepoint_folder_id: spResult.id,
            sharepoint_folder_url: spResult.webUrl,
          });
        } else {
          spWarning = "The project was saved but SharePoint folders could not be created. " +
                      "Use 'Create folders' on the project to retry.";
          console.error("Folder provisioning failed", newProject.project_number);
        }
      }

      return json({
        data: newProject,
        warning: spWarning,
        meta: {
          tasks_seeded: taskCount,
          sharepoint_created: !!spResult,
          sharepoint_warning: spWarning,
          sharepoint_subfolders: spResult?.subfolders ? Object.keys(spResult.subfolders).length : 0,
        },
      });
    }

    // ------------------------------------------------------------------------
    // BACKFILL PROJECT
    // ------------------------------------------------------------------------
    if (action === "backfill_project") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("backfill_project", caller)) {
        return json({ error: "Not authorized to backfill projects" }, 403);
      }
      const targetId = id || projectId;
      if (!targetId) return json({ error: "projectId required" }, 400);

      const { data: proj, error: pe } = await supabase
        .from("projects").select("*").eq("id", targetId).single();
      if (pe || !proj) return json({ error: pe?.message ?? "project not found" }, 404);

      const meta: Record<string, unknown> = {
        project_number: proj.project_number,
        tasks_already: 0, tasks_seeded: 0,
        sp_already: !!proj.sharepoint_folder_id, sp_created: false, sp_subfolders: 0,
        production_already: false, production_created: false,
      };

      const { count: existingCount } = await supabase
        .from("project_tasks").select("*", { count: "exact", head: true }).eq("project_id", proj.id);
      meta.tasks_already = existingCount ?? 0;
      if (!existingCount) {
        meta.tasks_seeded = await seedTasksFromTemplates(
          proj.id, proj.division,
          { pm_id: proj.pm_id, assistant_pm_id: proj.assistant_pm_id, estimator_id: proj.estimator_id },
        );
      }

      const { data: existingProd } = await supabase
        .from("project_production").select("id").eq("project_id", proj.id).maybeSingle();
      meta.production_already = !!existingProd;
      if (!existingProd) {
        const { error: prodErr } = await supabase
          .from("project_production").insert({ project_id: proj.id, pm_id: proj.pm_id ?? null });
        meta.production_created = !prodErr;
      }

      if (!proj.sharepoint_folder_id && providerToken) {
        const folderName = sanitizeFolderName(
          proj.project_number ?? String(proj.id),
          proj.project_address ?? "No_Address",
        );
        const spResult = await createProjectFolderTree(providerToken, folderName);
        if (spResult) {
          await supabase.from("projects").update({
            sharepoint_folder_id: spResult.id,
            sharepoint_folder_url: spResult.webUrl,
          }).eq("id", proj.id);
          meta.sp_created = true;
          meta.sp_subfolders = Object.keys(spResult.subfolders).length;
        }
      }

      return json({ data: proj, meta });
    }

    // ------------------------------------------------------------------------
    // UPDATE PROJECT (general)
    // ------------------------------------------------------------------------
    if (action === "update") {
      if (!projectId) return json({ error: "projectId required" }, 400);
      const caller = await lookupCallerProfile(userId, payload);
      // `update` is the generic field writer, but ProjectDetail also routes
      // stage and status changes through it — and Jorge's matrix scores those
      // rows differently ("Advance or change project stage" is — for Task
      // Manager, while "Edit project details" is ◐). So the capability is
      // chosen from what the payload actually touches; checking only
      // update_project_fields would hand every field-editor the stage control.
      const touched = Object.keys(updates ?? {});
      const needed = touched.includes("current_stage")
        ? "advance_stage"
        : touched.includes("status")
        ? "update_project_status"
        : "update_project_fields";
      if (!allow(needed, caller)) {
        return json({ error: "Not authorized to make this change" }, 403);
      }
      const { data, error } = await supabase.from("projects")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", projectId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // UPDATE PROJECT TEAM
    // ------------------------------------------------------------------------
    if (action === "update_project") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("assign_team", caller)) {
        return json({ error: "Not authorized to change the project team" }, 403);
      }
      const targetId = id || projectId;
      if (!targetId) return json({ error: "id required" }, 400);
      const { pm_id, assistant_pm_id } = body;
      const teamUpdate: Record<string, string | null | undefined> = {
        updated_at: new Date().toISOString(),
      };
      if (pm_id !== undefined) teamUpdate.pm_id = pm_id || null;
      if (assistant_pm_id !== undefined) teamUpdate.assistant_pm_id = assistant_pm_id || null;
      const { data, error } = await supabase.from("projects")
        .update(teamUpdate).eq("id", targetId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // UPDATE TASK
    // ------------------------------------------------------------------------
    if (action === "update_task") {
      if (!taskId) return json({ error: "taskId required" }, 400);
      const caller = await lookupCallerProfile(userId, payload);
      if (!caller || !caller.is_active) return json({ error: "Profile not found" }, 403);

      // Two ways in: edit_any_task, or it is your own task (toggle_own_task).
      // Until now this action had NO check at all — the "not assigned to you"
      // rule lived only in ProjectDetail.jsx, so any signed-in user could
      // complete or reopen any task on any project by calling this directly.
      const { data: existing, error: existErr } = await supabase
        .from("project_tasks")
        .select("id, assigned_to_id")
        .eq("id", taskId)
        .single();
      if (existErr || !existing) return json({ error: "Task not found" }, 404);

      const isOwnTask = !!existing.assigned_to_id && existing.assigned_to_id === caller.id;
      if (!allow("edit_any_task", caller) && !isOwnTask) {
        return json({ error: "Not authorized to edit this task" }, 403);
      }

      const taskUpdate: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
      if (updates?.status === "completed" && !updates.completed_at) {
        taskUpdate.completed_at = new Date().toISOString();
        // caller.id, not userId: userId is the Azure OID from the JWT, while
        // every other person-column on this table stores a profiles.id.
        taskUpdate.completed_by = caller.id;
      }
      const { data, error } = await supabase.from("project_tasks")
        .update(taskUpdate).eq("id", taskId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // ASSIGN TASK — POLICY.assign_task
    // Writes assigned_to_id, fires in-app notification, queues alert_log for email.
    // To open to more roles: edit POLICY above AND permissions.js.
    // ------------------------------------------------------------------------
    if (action === "assign_task") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("assign_task", caller)) {
        return json({ error: "Not authorized to assign tasks" }, 403);
      }

      if (!taskId) return json({ error: "taskId required" }, 400);
      const assigneeId: string | null = body.assigneeId ?? null;

      // Fetch current task for context (name, project_id, previous assignee)
      const { data: task, error: taskErr } = await supabase
        .from("project_tasks")
        .select("id, task_name, project_id, assigned_to_id")
        .eq("id", taskId)
        .single();
      if (taskErr || !task) return json({ error: "Task not found" }, 404);

      // Update the assignment
      const { data: updated, error: updateErr } = await supabase
        .from("project_tasks")
        .update({ assigned_to_id: assigneeId, updated_at: new Date().toISOString() })
        .eq("id", taskId)
        .select()
        .single();
      if (updateErr) return json({ error: updateErr.message }, 400);

      // Only notify if we're assigning to someone (not clearing)
      if (assigneeId) {
        // Check recipient's notification settings
        const { data: settings } = await supabase
          .from("notification_settings")
          .select("in_app, email, notify_new_assignment")
          .eq("user_id", assigneeId)
          .maybeSingle();

        // Default: notify unless explicitly opted out
        const sendInApp = settings ? (settings.in_app && settings.notify_new_assignment) : true;
        const sendEmail = settings ? (settings.email && settings.notify_new_assignment) : true;

        // Fetch project address for context
        const { data: proj } = await supabase
          .from("projects")
          .select("project_address, project_number")
          .eq("id", task.project_id)
          .single();

        const notifTitle = `New task assigned: ${task.task_name}`;
        const notifBody = proj
          ? `You've been assigned to "${task.task_name}" on project ${proj.project_number} — ${proj.project_address}.`
          : `You've been assigned to "${task.task_name}".`;

        // In-app notification
        if (sendInApp) {
          await supabase.from("notifications").insert({
            recipient_id: assigneeId,
            project_id: task.project_id,
            task_id: taskId,
            title: notifTitle,
            body: notifBody,
            type: "assignment",
          });
        }

        // Queue email via alert_log (picked up by future Graph email sender)
        if (sendEmail) {
          const { data: recipient } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", assigneeId)
            .single();

          if (recipient?.email) {
            const dedupKey = `assign_task_${taskId}_${assigneeId}_${Date.now()}`;
            await supabase.from("alert_log").insert({
              project_task_id: taskId,
              project_id: task.project_id,
              recipient_id: assigneeId,
              recipient_email: recipient.email,
              alert_type: "task_assigned",
              delivery_status: "queued",
              dedup_key: dedupKey,
              scheduled_at: new Date().toISOString(),
            }).maybeSingle(); // ignore conflict on dedup_key
          }
        }
      }

      return json({ data: updated });
    }

    // ------------------------------------------------------------------------
    // UPDATE MILESTONE
    // ------------------------------------------------------------------------
    if (action === "update_milestone") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_milestones", caller)) {
        return json({ error: "Not authorized to edit milestones" }, 403);
      }
      if (!milestoneId) return json({ error: "milestoneId required" }, 400);
      if (!updates || typeof updates !== "object") {
        return json({ error: "updates object required" }, 400);
      }

      const allowed: Record<string, unknown> = {};
      if (updates.value !== undefined) {
        const valid = ["Yes", "No", "Missing", "N/A"];
        if (!valid.includes(updates.value)) {
          return json({ error: `Invalid value '${updates.value}'. Must be one of: ${valid.join(", ")}` }, 400);
        }
        allowed.value = updates.value;
      }
      if (updates.milestone_date !== undefined) allowed.milestone_date = updates.milestone_date || null;
      if (updates.notes !== undefined)          allowed.notes = updates.notes || null;

      if (Object.keys(allowed).length === 0) {
        return json({ error: "No valid fields to update" }, 400);
      }

      allowed.updated_by = caller.id;   // profiles.id, not the JWT's Azure OID
      allowed.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from("project_milestones")
        .update(allowed).eq("id", milestoneId)
        .select("*, milestone_definitions(label, key, sort_order, active_from_stage)")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // UPLOAD FILE — now with proper category subfolder path
    // ------------------------------------------------------------------------
    if (action === "upload_file") {
      // POLICY.upload_file is "*" per Jorge's matrix, so this is an active-user
      // check rather than a role check — but it still has to be here, or a
      // deactivated account with a live JWT keeps write access to SharePoint.
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("upload_file", caller)) {
        return json({ error: "Not authorized to upload files" }, 403);
      }
      const targetId = projectId || id;
      const { category, fileName, fileContent, document_type } = body;
      if (!targetId || !fileName || !fileContent) {
        return json({ error: "projectId, fileName, fileContent required" }, 400);
      }
      if (!providerToken) return json({ error: "providerToken required for SharePoint upload" }, 400);

      const { data: proj, error: pe } = await supabase
        .from("projects").select("id, sharepoint_folder_id").eq("id", targetId).single();
      if (pe || !proj?.sharepoint_folder_id) {
        return json({ error: "Project has no SharePoint folder. Run backfill first." }, 400);
      }

      const safeName = fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const safePath = category
        ? `${category.split("/").map((s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")).join("/")}/${safeName}`
        : safeName;
      const uploadUrl = `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${proj.sharepoint_folder_id}:/${safePath}:/content`;

      const bytes = Uint8Array.from(atob(fileContent), (c) => c.charCodeAt(0));

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/octet-stream" },
        body: bytes,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        return json({ error: `SharePoint upload failed: ${err?.error?.message ?? uploadRes.status}` }, 500);
      }

      const driveItem = await uploadRes.json();

      const { data: profile } = await supabase
        .from("profiles").select("id").eq("azure_oid", userId).maybeSingle();

      const { data: doc } = await supabase.from("project_documents").insert({
        project_id: targetId,
        category: category ?? "2. Production/Job Site Binder",
        document_type: document_type ?? null,
        name: fileName,
        sharepoint_item_id: driveItem.id,
        sharepoint_url: driveItem.webUrl,
        sharepoint_drive_id: driveItem.parentReference?.driveId ?? null,
        file_size_bytes: driveItem.size ?? null,
        mime_type: driveItem.file?.mimeType ?? null,
        uploaded_by: profile?.id ?? null,
      }).select().single();

      return json({ data: doc, meta: { sharepoint_url: driveItem.webUrl } });
    }

    // ------------------------------------------------------------------------
    // DELETE FILE — soft-delete in DB, optionally remove from SharePoint
    // ------------------------------------------------------------------------
    if (action === "delete_file") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("delete_file", caller)) {
        return json({ error: "Not authorized to delete files" }, 403);
      }
      const docId = body.documentId;
      if (!docId) return json({ error: "documentId required" }, 400);

      const { data: doc } = await supabase
        .from("project_documents").select("*").eq("id", docId).single();
      if (!doc) return json({ error: "document not found" }, 404);

      // Soft delete in DB
      await supabase.from("project_documents")
        .update({ is_deleted: true }).eq("id", docId);

      // Attempt SharePoint removal (best-effort)
      if (providerToken && doc.sharepoint_item_id) {
        try {
          await fetch(
            `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${doc.sharepoint_item_id}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${providerToken}` } },
          );
        } catch (e) {
          console.error("SP delete failed:", e);
        }
      }

      return json({ data: { id: docId, is_deleted: true } });
    }

    // ========================================================================
    // STAFF MANAGEMENT ACTIONS
    // ========================================================================

    // ------------------------------------------------------------------------
    // UPSERT WHITELIST — invite a new person or update existing whitelist row
    // ------------------------------------------------------------------------
    if (action === "upsert_whitelist") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("manage_staff", caller)) {
        return json({ error: "Admin only" }, 403);
      }

      const { email, display_name, full_name, role, division, phone, title,
              tool_access, billing_access } = body;
      if (!email || !full_name) {
        return json({ error: "email and full_name required" }, 400);
      }
      if (role && !VALID_ROLES.includes(role)) {
        return json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, 400);
      }
      if (tool_access && !VALID_TOOL_ACCESS.includes(tool_access)) {
        return json({ error: `Invalid tool_access. Must be one of: ${VALID_TOOL_ACCESS.join(", ")}` }, 400);
      }
      if (billing_access && !VALID_BILLING_ACCESS.includes(billing_access)) {
        return json({ error: `Invalid billing_access. Must be one of: ${VALID_BILLING_ACCESS.join(", ")}` }, 400);
      }

      const normalizedEmail = String(email).toLowerCase().trim();

      // Check if already exists
      const { data: existing } = await supabase
        .from("staff_whitelist").select("*").eq("email", normalizedEmail).maybeSingle();

      const record = {
        email: normalizedEmail,
        display_name: display_name ?? full_name.split(" ")[0],
        full_name,
        role: role ?? "field_crew",
        division: division ?? null,
        phone: phone ?? null,
        title: title ?? null,
        tool_access: tool_access ?? "none",
        billing_access: billing_access ?? "none",
        is_active: true,
      };

      const { data, error } = await supabase
        .from("staff_whitelist").upsert(record, { onConflict: "email" }).select().single();

      if (error) return json({ error: error.message }, 400);

      // Audit
      await writeAudit(
        normalizedEmail,
        existing ? "update_whitelist" : "invite",
        caller.id,
        existing ?? null,
        data,
      );

      // If a profile already exists (e.g. re-adding after deactivation), also
      // reactivate and update the profile to match the new whitelist data
      const { data: existingProfile } = await supabase
        .from("profiles").select("*").eq("email", normalizedEmail).maybeSingle();

      if (existingProfile) {
        await supabase.from("profiles").update({
          full_name: record.full_name,
          display_name: record.display_name,
          role: record.role,
          division: record.division,
          phone: record.phone,
          title: record.title,
          tool_access: record.tool_access,
          billing_access: record.billing_access,
          is_active: true,
          updated_at: new Date().toISOString(),
        }).eq("id", existingProfile.id);
      }

      return json({ data, meta: { reactivated_profile: !!existingProfile } });
    }

    // ------------------------------------------------------------------------
    // UPDATE PROFILE — change role, division, etc. for an existing user
    // ------------------------------------------------------------------------
    if (action === "update_profile") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("manage_staff", caller)) {
        return json({ error: "Admin only" }, 403);
      }

      const profileId = body.profileId;
      if (!profileId) return json({ error: "profileId required" }, 400);

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", profileId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      const allowed: Record<string, unknown> = {};
      if (updates?.role !== undefined) {
        if (!VALID_ROLES.includes(updates.role)) {
          return json({ error: `Invalid role` }, 400);
        }
        allowed.role = updates.role;
      }
      if (updates?.division !== undefined)     allowed.division = updates.division || null;
      if (updates?.display_name !== undefined) allowed.display_name = updates.display_name;
      if (updates?.full_name !== undefined)    allowed.full_name = updates.full_name;
      if (updates?.title !== undefined)        allowed.title = updates.title || null;
      if (updates?.phone !== undefined)        allowed.phone = updates.phone || null;
      if (updates?.tool_access !== undefined) {
        if (!VALID_TOOL_ACCESS.includes(updates.tool_access)) {
          return json({ error: `Invalid tool_access` }, 400);
        }
        allowed.tool_access = updates.tool_access;
      }
      if (updates?.billing_access !== undefined) {
        if (!VALID_BILLING_ACCESS.includes(updates.billing_access)) {
          return json({ error: `Invalid billing_access` }, 400);
        }
        allowed.billing_access = updates.billing_access;
      }

      if (Object.keys(allowed).length === 0) {
        return json({ error: "No valid fields to update" }, 400);
      }
      allowed.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from("profiles")
        .update(allowed).eq("id", profileId).select().single();
      if (error) return json({ error: error.message }, 400);

      // Also mirror role/division/hat changes to the whitelist for consistency.
      // Without this a deactivate-then-reinvite would silently restore the old
      // access level from the stale whitelist row.
      if (allowed.role || allowed.division !== undefined ||
          allowed.tool_access !== undefined || allowed.billing_access !== undefined) {
        const mirror: Record<string, unknown> = {};
        if (allowed.role !== undefined) mirror.role = allowed.role;
        if (allowed.division !== undefined) mirror.division = allowed.division;
        if (allowed.tool_access !== undefined) mirror.tool_access = allowed.tool_access;
        if (allowed.billing_access !== undefined) mirror.billing_access = allowed.billing_access;
        await supabase.from("staff_whitelist")
          .update(mirror).eq("email", existing.email);
      }

      await writeAudit(existing.email, "update_role", caller.id, existing, data);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // DEACTIVATE STAFF — soft off-boarding (reversible)
    // Flips is_active=false on BOTH profile and whitelist.
    // User can still be reactivated from the Inactive Staff tab.
    // ------------------------------------------------------------------------
    if (action === "deactivate_staff") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("manage_staff", caller)) {
        return json({ error: "Admin only" }, 403);
      }

      const targetId = body.profileId;
      if (!targetId) return json({ error: "profileId required" }, 400);

      if (targetId === caller.id) {
        return json({ error: "Cannot deactivate yourself" }, 400);
      }

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", targetId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      await supabase.from("profiles")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", targetId);

      await supabase.from("staff_whitelist")
        .update({ is_active: false }).eq("email", existing.email);

      await writeAudit(existing.email, "deactivate", caller.id, existing, { is_active: false });

      return json({ data: { profileId: targetId, email: existing.email, is_active: false } });
    }

    // ------------------------------------------------------------------------
    // REACTIVATE STAFF — restore a previously-deactivated person
    // ------------------------------------------------------------------------
    if (action === "reactivate_staff") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("manage_staff", caller)) {
        return json({ error: "Admin only" }, 403);
      }

      const targetId = body.profileId;
      if (!targetId) return json({ error: "profileId required" }, 400);

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", targetId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      await supabase.from("profiles")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", targetId);

      await supabase.from("staff_whitelist")
        .update({ is_active: true }).eq("email", existing.email);

      await writeAudit(existing.email, "reactivate", caller.id, existing, { is_active: true });

      return json({ data: { profileId: targetId, email: existing.email, is_active: true } });
    }

    // ------------------------------------------------------------------------
    // HARD DELETE STAFF — destructive, admin-panel-only
    // Wipes profile + whitelist. Keeps audit log row forever.
    // Requires confirm=true in body (caller UI must collect explicit confirmation).
    // ------------------------------------------------------------------------
    if (action === "hard_delete_staff") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("manage_staff", caller)) {
        return json({ error: "Admin only" }, 403);
      }

      if (body.confirm !== true) {
        return json({ error: "confirm=true required for destructive action" }, 400);
      }

      const targetId = body.profileId;
      if (!targetId) return json({ error: "profileId required" }, 400);

      if (targetId === caller.id) {
        return json({ error: "Cannot delete yourself" }, 400);
      }

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", targetId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      // Write audit FIRST (before we nuke the profile — FK reference needed)
      await writeAudit(
        existing.email, "hard_delete", caller.id, existing, null,
        body.reason ?? "Hard delete by admin",
      );

      // Wipe whitelist (no FK constraints)
      await supabase.from("staff_whitelist").delete().eq("email", existing.email);

      // Wipe profile — FK constraints on project_tasks.assigned_to_id etc. will
      // cascade NULL via the existing FK definitions. If any FK is ON DELETE RESTRICT,
      // this will fail safely and return an error.
      const { error: delErr } = await supabase.from("profiles").delete().eq("id", targetId);
      if (delErr) {
        return json({
          error: `Cannot hard delete: ${delErr.message}. Use deactivate instead.`,
        }, 400);
      }

      return json({ data: { profileId: targetId, email: existing.email, deleted: true } });
    }

    // ------------------------------------------------------------------------

    // ========================================================================
    // TOOL CONTROL ACTIONS  (Phase B)
    // Catalog = public.tools ; append-only ledger = public.tool_transactions.
    // Denormalized current_* on tools is kept in sync on every state change.
    // enroll / update / retire  -> admin || tool_manager
    // checkout / checkin / maintenance -> any active profile (tighten later).
    // Reads are direct from the frontend via RLS SELECT — not proxied here.
    // ========================================================================

    // Upload up to 2 tool photos to SharePoint Tools/{asset_id}/ and return their
    // webUrls. `photos` is an array of base64 strings (no data: prefix). Graph
    // path-upload auto-creates the folder. Throws if photos present but no token.
    async function uploadToolPhotos(assetId: string, actionTag: string, photos: unknown): Promise<string[]> {
      const list = Array.isArray(photos) ? photos.slice(0, 2) : [];
      if (list.length === 0) return [];
      if (!providerToken) throw new Error("providerToken required for photo upload");
      const safeAsset = String(assetId).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const ts = Date.now();
      const urls: string[] = [];
      let i = 0;
      for (const item of list) {
        i++;
        const content = typeof item === "string" ? item : (item as { content?: string })?.content;
        if (!content) continue;
        const fname = `${safeAsset}-${actionTag}-${i}-${ts}.jpg`;
        const url = `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/root:/Tools/${safeAsset}/${fname}:/content`;
        const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
        const up = await fetch(url, {
          method: "PUT",
          headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/octet-stream" },
          body: bytes,
        });
        if (!up.ok) {
          const e = await up.json().catch(() => ({}));
          throw new Error(`Photo upload failed: ${e?.error?.message ?? up.status}`);
        }
        const j = await up.json();
        if (j.webUrl) urls.push(j.webUrl);
      }
      return urls;
    }

    // ENROLL a new tool ------------------------------------------------------
    if (action === "enroll_tool") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!caller || !caller.is_active) return json({ error: "No active profile" }, 403);
      // Tool ADMIN tier. Was gated on role === "tool_manager", a role the
      // 8-role model retired — after 13_seed_access_matrix.sql nobody holds it,
      // so every hat-holder was 403ing on a button the sidebar still showed.
      if (!hasTool(caller, "admin")) {
        return json({ error: "Not authorized to enroll tools" }, 403);
      }
      const t = body.tool ?? {};
      if (!t.name || !t.serial) {
        return json({ error: "name and serial required" }, 400);
      }

      // Asset ID is generated HERE (server-side), never trusted from the client —
      // two devices generating client-side both produced PYR-0001 and collided.
      // Derive the next number from the current max PYR-#### and, on a unique
      // clash from a concurrent enroll, bump and retry.
      const { data: idRows } = await supabase.from("tools")
        .select("asset_id").ilike("asset_id", "PYR-%");
      let maxN = 0;
      for (const r of idRows ?? []) {
        const n = parseInt(String(r.asset_id).replace(/^PYR-/i, ""), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }

      let tool = null, lastErr = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const assetId = "PYR-" + String(maxN + attempt).padStart(4, "0");
        const { data, error } = await supabase.from("tools")
          .insert({ ...t, asset_id: assetId, status: "available", created_by: caller.id })
          .select().single();
        if (!error) { tool = data; break; }
        if (error.code === "23505") { lastErr = error; continue; } // unique clash -> retry
        return json({ error: error.message }, 400);
      }
      if (!tool) return json({ error: lastErr?.message ?? "Could not allocate an asset ID" }, 409);

      let enrollPhotos: string[] = [];
      try { enrollPhotos = await uploadToolPhotos(tool.asset_id, "enroll", body.photos); }
      catch (e) { return json({ error: (e as Error).message }, 500); }
      if (enrollPhotos.length) {
        await supabase.from("tools").update({ photo_urls: enrollPhotos }).eq("id", tool.id);
        tool.photo_urls = enrollPhotos;
      }

      await supabase.from("tool_transactions").insert({
        tool_id: tool.id, action: "enrolled",
        profile_id: caller.id, created_by: caller.id, note: body.note ?? null,
        photo_urls: enrollPhotos,
      });
      return json({ data: tool });
    }

    // CHECK OUT a tool to a tech + job ---------------------------------------
    // Open to any active profile ON PURPOSE: "Check a tool out / in" sits in the
    // "Basic use (any role)" column of Jorge's Tool Control table, so it needs
    // no hat. Maintenance, QR tags and reports are the tech tier; the catalog
    // is the admin tier.
    if (action === "checkout_tool") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!caller || !caller.is_active) return json({ error: "No active profile" }, 403);
      const { toolId, profileId, expectedReturnDate, note } = body;
      const jobId = body.jobProjectId ?? null;
      if (!toolId || !profileId) return json({ error: "toolId and profileId required" }, 400);

      let outPhotos: string[] = [];
      if (Array.isArray(body.photos) && body.photos.length) {
        const { data: trow } = await supabase.from("tools").select("asset_id").eq("id", toolId).single();
        try { outPhotos = await uploadToolPhotos(trow?.asset_id ?? toolId, "out", body.photos); }
        catch (e) { return json({ error: (e as Error).message }, 500); }
      }

      await supabase.from("tool_transactions").insert({
        tool_id: toolId, action: "out",
        profile_id: profileId, project_id: jobId,
        expected_return_date: expectedReturnDate ?? null,
        note: note ?? null, created_by: caller.id,
        photo_urls: outPhotos,
      });
      const { data: tool, error } = await supabase.from("tools")
        .update({
          status: "out", current_holder_id: profileId,
          current_project_id: jobId, updated_at: new Date().toISOString(),
        })
        .eq("id", toolId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: tool });
    }

    // CHECK IN a tool (optional condition photo -> SharePoint Tools/{asset}/) -
    if (action === "checkin_tool") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!caller || !caller.is_active) return json({ error: "No active profile" }, 403);
      const { toolId, condition, note, photoFileName, photoContent, toMaintenance } = body;
      if (!toolId) return json({ error: "toolId required" }, 400);

      const { data: existing, error: te } = await supabase.from("tools")
        .select("id, asset_id").eq("id", toolId).single();
      if (te || !existing) return json({ error: "tool not found" }, 404);

      // Condition photos (up to 2). Accept the new `photos` array; fall back to
      // the legacy single photoFileName/photoContent for older clients.
      let inPhotos: string[] = [];
      const legacy = (photoContent && photoFileName) ? [photoContent] : [];
      try { inPhotos = await uploadToolPhotos(existing.asset_id, "in", (Array.isArray(body.photos) && body.photos.length) ? body.photos : legacy); }
      catch (e) { return json({ error: (e as Error).message }, 500); }
      const photoUrl = inPhotos[0] ?? null;

      await supabase.from("tool_transactions").insert({
        tool_id: toolId, action: "in",
        profile_id: caller.id, condition: condition ?? null,
        photo_url: photoUrl, photo_urls: inPhotos,
        note: note ?? null, created_by: caller.id,
      });
      const { data: tool, error } = await supabase.from("tools")
        .update({
          status: toMaintenance ? "maintenance" : "available",
          current_holder_id: null, current_project_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", toolId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: tool, meta: { photo_url: photoUrl } });
    }

    // MAINTENANCE toggle (send to / return from) -----------------------------
    if (action === "tool_maintenance") {
      const caller = await lookupCallerProfile(userId, payload);
      // Tool TECH tier. "Log maintenance" is ✓ for Tool Admin and Tool Tech and
      // — for basic use, unlike check-out/check-in which any role may do.
      if (!hasTool(caller, "tech")) {
        return json({ error: "Not authorized to log tool maintenance" }, 403);
      }
      const { toolId, condition, note, back } = body;
      if (!toolId) return json({ error: "toolId required" }, 400);

      await supabase.from("tool_transactions").insert({
        tool_id: toolId, action: "maintenance",
        profile_id: caller.id, condition: condition ?? null,
        note: note ?? null, created_by: caller.id,
      });
      const { data: tool, error } = await supabase.from("tools")
        .update({ status: back ? "available" : "maintenance", updated_at: new Date().toISOString() })
        .eq("id", toolId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: tool });
    }

    // RETIRE a tool (Tool Admin hat) -----------------------------------------
    if (action === "retire_tool") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!caller || !caller.is_active) return json({ error: "No active profile" }, 403);
      // Tool ADMIN tier. Was gated on role === "tool_manager", a role the
      // 8-role model retired — after 13_seed_access_matrix.sql nobody holds it,
      // so every hat-holder was 403ing on a button the sidebar still showed.
      if (!hasTool(caller, "admin")) {
        return json({ error: "Not authorized to retire tools" }, 403);
      }
      const { toolId, note } = body;
      if (!toolId) return json({ error: "toolId required" }, 400);

      await supabase.from("tool_transactions").insert({
        tool_id: toolId, action: "retired",
        profile_id: caller.id, note: note ?? null, created_by: caller.id,
      });
      const { data: tool, error } = await supabase.from("tools")
        .update({
          status: "retired", current_holder_id: null,
          current_project_id: null, updated_at: new Date().toISOString(),
        })
        .eq("id", toolId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: tool });
    }

    // UPDATE catalog fields (Tool Admin hat) — never touches state ---------
    if (action === "update_tool") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!caller || !caller.is_active) return json({ error: "No active profile" }, 403);
      // Tool ADMIN tier. Was gated on role === "tool_manager", a role the
      // 8-role model retired — after 13_seed_access_matrix.sql nobody holds it,
      // so every hat-holder was 403ing on a button the sidebar still showed.
      if (!hasTool(caller, "admin")) {
        return json({ error: "Not authorized to edit tools" }, 403);
      }
      const toolId = body.toolId || id;
      if (!toolId) return json({ error: "toolId required" }, 400);
      // Strip state columns — those move only via checkout/checkin/maintenance/retire.
      const clean: Record<string, unknown> = { ...(updates ?? {}) };
      delete clean.status; delete clean.current_holder_id;
      delete clean.current_project_id; delete clean.id;
      delete clean.created_by; delete clean.created_at;
      const { data: tool, error } = await supabase.from("tools")
        .update({ ...clean, updated_at: new Date().toISOString() })
        .eq("id", toolId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: tool });
    }


    // SELECT PROJECTS
    // ------------------------------------------------------------------------
    if (action === "select") {
      const { data, error } = await supabase.from("projects")
        .select("*").order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ========================================================================
    // CLIENT / SITE / CONTACT  —  Deploy B
    // ------------------------------------------------------------------------
    // All writes are proxy-only (RLS grants authenticated SELECT and nothing
    // else). Reads go straight from the frontend via the authenticated client.
    //
    // SharePoint folders for clients and sites are addressed by driveItem ID,
    // never by path, so a rename or a move_site cannot orphan them.
    // ========================================================================

    // ---- CLIENTS -----------------------------------------------------------
    if (action === "client_create") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("create_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }

      const { client } = body;
      if (!client?.name) return json({ error: "Client name is required" }, 400);

      const { data: newClient, error } = await supabase.from("clients")
        .insert({ ...client, created_by: caller.id })
        .select().single();
      if (error) return json({ error: error.message }, 400);

      // Folder provisioning. DB is authoritative — never roll the row back.
      let warning: string | null = null;
      if (!providerToken) {
        warning = "Client saved, but SharePoint folder was not created (no Graph token). Use 'Create folders' to retry.";
        console.error("client folder skipped — no Graph token", newClient.name);
      } else {
        const folder = await createGraphFolder(
          providerToken, sanitizeEntityName(newClient.name, 28), null,
        );
        if (folder) {
          await supabase.from("clients").update({
            sharepoint_folder_id: folder.id,
            sharepoint_folder_url: folder.webUrl,
          }).eq("id", newClient.id);
          Object.assign(newClient, {
            sharepoint_folder_id: folder.id,
            sharepoint_folder_url: folder.webUrl,
          });
        } else {
          warning = "Client saved, but the SharePoint folder could not be created. Use 'Create folders' to retry.";
        }
      }
      return json({ data: newClient, warning });
    }

    if (action === "client_update") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { id: clientId, updates: clientUpdates } = body;
      if (!clientId) return json({ error: "clientId required" }, 400);
      const { data, error } = await supabase.from("clients")
        .update({ ...clientUpdates, updated_at: new Date().toISOString() })
        .eq("id", clientId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // Soft delete. Clients are referenced by sites, contacts, and projects;
    // a hard delete would either cascade or fail on the sites restrict FK.
    if (action === "client_delete") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("delete_client", caller)) return json({ error: "Admin only" }, 403);
      const { id: clientId } = body;
      const { data, error } = await supabase.from("clients")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", clientId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // Promote prospect -> client. Called when a project is awarded (Stage 3).
    // Idempotent; safe to call on an already-promoted client.
    if (action === "client_promote") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { id: clientId } = body;
      if (!clientId) return json({ error: "clientId required" }, 400);
      const { data, error } = await supabase.from("clients")
        .update({ relationship_status: "client", updated_at: new Date().toISOString() })
        .eq("id", clientId).eq("relationship_status", "prospect")
        .select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      return json({ data, promoted: !!data });
    }

    // ---- SITES -------------------------------------------------------------
    if (action === "site_create") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("create_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }

      const { site } = body;
      if (!site?.client_id) return json({ error: "client_id is required" }, 400);
      if (!site?.name) return json({ error: "Site name is required" }, 400);

      const { data: newSite, error } = await supabase.from("sites")
        .insert({ ...site, created_by: caller.id })
        .select().single();
      if (error) return json({ error: error.message }, 400);

      let warning: string | null = null;
      if (providerToken) {
        const { data: parent } = await supabase.from("clients")
          .select("sharepoint_folder_id").eq("id", site.client_id).maybeSingle();
        if (parent?.sharepoint_folder_id) {
          const folder = await createGraphFolder(
            providerToken, sanitizeEntityName(newSite.name, 28), parent.sharepoint_folder_id,
          );
          if (folder) {
            await supabase.from("sites").update({
              sharepoint_folder_id: folder.id,
              sharepoint_folder_url: folder.webUrl,
            }).eq("id", newSite.id);
            Object.assign(newSite, {
              sharepoint_folder_id: folder.id,
              sharepoint_folder_url: folder.webUrl,
            });
          } else {
            warning = "Site saved, but its SharePoint folder could not be created.";
          }
        } else {
          warning = "Site saved. The client has no SharePoint folder yet — create the client folder first, then retry.";
        }
      } else {
        warning = "Site saved, but SharePoint folder was not created (no Graph token).";
      }
      return json({ data: newSite, warning });
    }

    if (action === "site_update") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { id: siteId, updates: siteUpdates } = body;
      if (!siteId) return json({ error: "siteId required" }, 400);
      // client_id changes go through move_site so the folder follows.
      const safe = { ...siteUpdates };
      delete safe.client_id;
      const { data, error } = await supabase.from("sites")
        .update({ ...safe, updated_at: new Date().toISOString() })
        .eq("id", siteId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    if (action === "site_delete") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("delete_client", caller)) return json({ error: "Admin only" }, 403);
      const { id: siteId } = body;
      const { data, error } = await supabase.from("sites")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", siteId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ---- MOVE SITE TO A DIFFERENT CLIENT -----------------------------------
    // A building changes management company. The DB row is reassigned and the
    // SharePoint folder is MOVED server-side (Graph PATCH on parentReference),
    // so every project and file under it follows. IDs and version history are
    // preserved. qb_customer_job on existing projects is deliberately NOT
    // rewritten — invoices raised under the old agent stay keyed to the old
    // agent.
    if (action === "move_site") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("move_site", caller)) return json({ error: "Admin only" }, 403);

      const { siteId, newClientId } = body;
      if (!siteId || !newClientId) {
        return json({ error: "siteId and newClientId are required" }, 400);
      }

      const { data: site } = await supabase.from("sites")
        .select("id, name, client_id, sharepoint_folder_id").eq("id", siteId).maybeSingle();
      if (!site) return json({ error: "Site not found" }, 404);
      if (site.client_id === newClientId) {
        return json({ error: "Site already belongs to that client" }, 400);
      }

      const { data: newParent } = await supabase.from("clients")
        .select("id, name, sharepoint_folder_id").eq("id", newClientId).maybeSingle();
      if (!newParent) return json({ error: "Target client not found" }, 404);

      // DB first. A row pointing at the old folder is recoverable; a moved
      // folder with no row is an orphan.
      const { data: moved, error } = await supabase.from("sites")
        .update({ client_id: newClientId, updated_at: new Date().toISOString() })
        .eq("id", siteId).select().single();
      if (error) return json({ error: error.message }, 400);

      let warning: string | null = null;
      if (!providerToken) {
        warning = "Site reassigned, but the SharePoint folder was not moved (no Graph token).";
      } else if (!site.sharepoint_folder_id) {
        warning = "Site reassigned. It had no SharePoint folder to move.";
      } else if (!newParent.sharepoint_folder_id) {
        warning = "Site reassigned, but the target client has no SharePoint folder. Create it, then use 'Create folders'.";
      } else {
        const ok = await moveGraphItem(
          providerToken, site.sharepoint_folder_id, newParent.sharepoint_folder_id,
        );
        if (!ok) {
          warning = "Site reassigned in the app, but the SharePoint folder move failed. The folder is still under the old client.";
        }
      }

      // Was called with three args against a 5-6 arg signature: the profile id
      // landed in `email`, the payload object in `changedBy`, and old/new were
      // never passed. The .catch() swallowed the resulting insert failure, so
      // every site move audited as nothing at all.
      await writeAudit(
        caller.email,
        "move_site",
        caller.id,
        { site_id: siteId, site_name: site.name, client_id: site.client_id },
        { site_id: siteId, site_name: site.name, client_id: newClientId },
      ).catch(() => {});

      return json({ data: moved, warning });
    }

    // ---- CONTACTS ----------------------------------------------------------
    if (action === "contact_create") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("create_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { contact, siteIds } = body;
      if (!contact?.client_id) return json({ error: "client_id is required" }, 400);

      const { data: newContact, error } = await supabase.from("contacts")
        .insert({ ...contact, created_by: caller.id })
        .select().single();
      if (error) return json({ error: error.message }, 400);

      // One person can cover several buildings.
      if (Array.isArray(siteIds) && siteIds.length) {
        const links = siteIds.map((sid: string) => ({ site_id: sid, contact_id: newContact.id }));
        await supabase.from("site_contacts").upsert(links, { onConflict: "site_id,contact_id" });
      }
      return json({ data: newContact });
    }

    if (action === "contact_update") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { id: contactId, updates: contactUpdates, siteIds } = body;
      if (!contactId) return json({ error: "contactId required" }, 400);

      const { data, error } = await supabase.from("contacts")
        .update({ ...contactUpdates, updated_at: new Date().toISOString() })
        .eq("id", contactId).select().single();
      if (error) return json({ error: error.message }, 400);

      // When siteIds is supplied it is authoritative — replace the set.
      if (Array.isArray(siteIds)) {
        await supabase.from("site_contacts").delete().eq("contact_id", contactId);
        if (siteIds.length) {
          await supabase.from("site_contacts")
            .insert(siteIds.map((sid: string) => ({ site_id: sid, contact_id: contactId })));
        }
      }
      return json({ data });
    }

    if (action === "contact_delete") {
      const caller = await lookupCallerProfile(userId, payload);
      // Soft delete of a contact row — edit tier, not delete_client (which
      // governs the client record itself and stays Admin-only).
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { id: contactId } = body;
      const { data, error } = await supabase.from("contacts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", contactId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    if (action === "site_contact_add") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("create_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { siteId, contactId, roleNote } = body;
      if (!siteId || !contactId) return json({ error: "siteId and contactId required" }, 400);
      const { data, error } = await supabase.from("site_contacts")
        .upsert({ site_id: siteId, contact_id: contactId, role_note: roleNote ?? null },
                { onConflict: "site_id,contact_id" })
        .select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    if (action === "site_contact_remove") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { siteId, contactId } = body;
      const { error } = await supabase.from("site_contacts")
        .delete().eq("site_id", siteId).eq("contact_id", contactId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "project_contact_add") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("create_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { projectId: pid, contactId, roleNote } = body;
      if (!pid || !contactId) return json({ error: "projectId and contactId required" }, 400);
      const { data, error } = await supabase.from("project_contacts")
        .upsert({ project_id: pid, contact_id: contactId, role_note: roleNote ?? null },
                { onConflict: "project_id,contact_id" })
        .select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    if (action === "project_contact_remove") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("edit_client", caller)) {
        return json({ error: "Not authorized to change client records" }, 403);
      }
      const { projectId: pid, contactId } = body;
      const { error } = await supabase.from("project_contacts")
        .delete().eq("project_id", pid).eq("contact_id", contactId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ---- BACKFILL CLIENT / SITE FOLDERS ------------------------------------
    // Provisions anything where sharepoint_folder_id IS NULL. Clients first,
    // because a site folder needs its client folder to exist as a parent.
    if (action === "backfill_folders") {
      const caller = await lookupCallerProfile(userId, payload);
      if (!allow("backfill_folders", caller)) return json({ error: "Admin only" }, 403);
      if (!providerToken) return json({ error: "No Graph token available" }, 503);

      const result = { clients: 0, sites: 0, failed: [] as string[] };

      const { data: pendingClients } = await supabase.from("clients")
        .select("id, name").is("sharepoint_folder_id", null).eq("is_active", true);
      for (const c of pendingClients ?? []) {
        const f = await createGraphFolder(providerToken, sanitizeEntityName(c.name, 28), null);
        if (f) {
          await supabase.from("clients")
            .update({ sharepoint_folder_id: f.id, sharepoint_folder_url: f.webUrl })
            .eq("id", c.id);
          result.clients++;
        } else result.failed.push(`client: ${c.name}`);
      }

      const { data: pendingSites } = await supabase.from("sites")
        .select("id, name, client_id").is("sharepoint_folder_id", null).eq("is_active", true);
      for (const s of pendingSites ?? []) {
        const { data: parent } = await supabase.from("clients")
          .select("sharepoint_folder_id").eq("id", s.client_id).maybeSingle();
        if (!parent?.sharepoint_folder_id) { result.failed.push(`site (no client folder): ${s.name}`); continue; }
        const f = await createGraphFolder(providerToken, sanitizeEntityName(s.name, 28), parent.sharepoint_folder_id);
        if (f) {
          await supabase.from("sites")
            .update({ sharepoint_folder_id: f.id, sharepoint_folder_url: f.webUrl })
            .eq("id", s.id);
          result.sites++;
        } else result.failed.push(`site: ${s.name}`);
      }

      return json({ data: result });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("project-proxy unhandled:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});