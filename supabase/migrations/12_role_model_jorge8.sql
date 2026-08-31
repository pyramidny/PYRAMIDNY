-- ============================================================================
-- 12_role_model_jorge8.sql  —  Jorge's 8-role model + add-on "hats"
-- App: Pyramid Restoration Staff Portal (app.pyramidny.com)
-- Org/Project: izjaxmcdlsdkdliqjlei  (PYRAMID CLIENT COMMAND)
-- Run in: Supabase SQL Editor, top to bottom. Additive only — no data loss.
--
-- WHY THIS EXISTS
-- Jorge's permission matrix defines 8 base roles plus two independent add-on
-- "hats" (Tool, Billing) that layer on ANY base role. The DB enum was built
-- around 12 job-title roles instead. Rather than rewrite the role on every
-- live user, we keep the existing identifiers and re-label them to Jorge's
-- words in the UI. Only one genuinely new base role exists: overseer.
--
--   Jorge's name   →  DB identifier (unchanged)
--   -----------------------------------------------
--   Admin          →  admin
--   Overseer       →  overseer                (NEW — added below)
--   Director       →  director_of_operations
--   Task Manager   →  task_manager
--   PM             →  project_manager
--   PM Asst        →  assistant_pm
--   Estimator      →  estimator
--   Field Tech     →  field_crew
--
-- Jorge's model folds these old job-title roles into "base role + hat", so
-- they are RETIRED from the UI picker (the enum values remain — Postgres
-- cannot drop enum values — they simply stop being offered or accepted):
--   office_manager, purchasing_manager, billing_coordinator,
--   estimating_coordinator, sales_rep, tool_manager
-- Step 4 reports anyone still sitting on one so they get remapped in the seed.
--
-- Creates:
--   1. overseer value on the user_role enum
--   2. tool_access + billing_access columns on profiles AND staff_whitelist
--   3. backfill of tool_access from the retiring tool_manager role
--   4. diagnostics
-- ============================================================================


-- 1) NEW BASE ROLE ------------------------------------------------------------
-- Its own statement, before anything references it. IF NOT EXISTS makes a
-- re-run safe. If the SQL editor returns "cannot run inside a transaction
-- block", run this single line on its own first, then the rest.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'overseer';


-- 2) ADD-ON HATS --------------------------------------------------------------
-- text + CHECK rather than enums, matching the precedent set by tools.status in
-- 05_tool_control.sql: new tiers can be added with a one-line migration instead
-- of ALTER TYPE.
--
-- NOTE — deviation from the recap, which said "nullable": these are
-- NOT NULL DEFAULT 'none'. Same additive, breaks-nothing property, but the
-- permission check never has to distinguish NULL from 'none'. A null-vs-'none'
-- ambiguity in a column that gates financial writes is not worth the risk.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tool_access text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS billing_access text NOT NULL DEFAULT 'none';

ALTER TABLE public.staff_whitelist
  ADD COLUMN IF NOT EXISTS tool_access text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS billing_access text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_tool_access_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_tool_access_check
      CHECK (tool_access IN ('none','tech','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_billing_access_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_billing_access_check
      CHECK (billing_access IN ('none','view','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_whitelist_tool_access_check') THEN
    ALTER TABLE public.staff_whitelist
      ADD CONSTRAINT staff_whitelist_tool_access_check
      CHECK (tool_access IN ('none','tech','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_whitelist_billing_access_check') THEN
    ALTER TABLE public.staff_whitelist
      ADD CONSTRAINT staff_whitelist_billing_access_check
      CHECK (billing_access IN ('none','view','admin'));
  END IF;
END $$;


-- 3) BACKFILL THE TOOL HAT ----------------------------------------------------
-- Tool Control is gated on role = 'tool_manager' today (Layout.jsx,
-- ToolControl.jsx). Anyone holding that role keeps their access as a hat BEFORE
-- their base role is reassigned by the seed, so nobody loses Tool Control in
-- the gap between this migration and the seed.
UPDATE public.profiles
   SET tool_access = 'admin'
 WHERE role::text = 'tool_manager' AND tool_access = 'none';

UPDATE public.staff_whitelist
   SET tool_access = 'admin'
 WHERE role::text = 'tool_manager' AND tool_access = 'none';


-- 4) DIAGNOSTICS --------------------------------------------------------------
-- Anyone still on a role Jorge's model retires. Each of these needs a base role
-- + hats assigned by the seed, or they will show a blank role in Team
-- Management. Expected from the matrix: Nina (office_manager -> admin + tool
-- tech + billing admin), Jesus Cruz (purchasing_manager -> project_manager +
-- tool admin + billing admin), Noemi Santos (-> overseer + billing admin).
SELECT email, full_name, role::text AS retired_role, division, tool_access, billing_access
  FROM public.profiles
 WHERE role::text IN ('office_manager','purchasing_manager','billing_coordinator',
                      'estimating_coordinator','sales_rep','tool_manager')
 ORDER BY role::text, full_name;

-- Current spread across the 8 keepers.
SELECT role::text AS role, COUNT(*) AS people,
       COUNT(*) FILTER (WHERE tool_access <> 'none')    AS with_tool_hat,
       COUNT(*) FILTER (WHERE billing_access <> 'none') AS with_billing_hat
  FROM public.profiles
 WHERE is_active
 GROUP BY role::text
 ORDER BY role::text;
