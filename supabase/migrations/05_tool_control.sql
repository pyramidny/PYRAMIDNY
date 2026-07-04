-- ============================================================================
-- 05_tool_control.sql  —  Tool Control Phase B (Supabase wiring)
-- App: Pyramid Restoration Staff Portal (app.pyramidny.com)
-- Org/Project: izjaxmcdlsdkdliqjlei  (PYRAMID CLIENT COMMAND)
-- Run in: Supabase SQL Editor, top to bottom. Additive only — no data changes.
--
-- Creates:
--   1. tool_manager value on the user_role enum
--   2. tools            (catalog, denormalized current holder/job)
--   3. tool_transactions (append-only ledger — source of truth for history)
--   + indexes, updated_at trigger, RLS (authenticated SELECT; writes via proxy)
-- ============================================================================


-- 1) ROLE ---------------------------------------------------------------------
-- Added as its own statement, before anything references it. IF NOT EXISTS
-- makes a re-run safe. permissions.js opens the enroll gate to this role;
-- more roles can be added to that array later with no further migration.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'tool_manager';
-- If the SQL editor ever returns "cannot run inside a transaction block" on
-- the line above, run that single line on its own first, then run the rest.


-- 2) CATALOG: tools -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tools (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id              text NOT NULL UNIQUE,          -- the QR tag, e.g. PYR-0001
  name                  text NOT NULL,
  manufacturer          text,
  model                 text,
  serial                text NOT NULL,
  category              text,
  replacement_value     numeric,

  -- lifecycle status; text + CHECK (not an enum) so we can add states like
  -- 'lost' / 'reserved' later with a one-line migration instead of ALTER TYPE.
  status                text NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available','out','maintenance','retired')),

  -- denormalized "current" fields for fast list reads. Source of truth is the
  -- latest tool_transactions row; the proxy keeps these in sync on every write.
  current_holder_id     uuid,                          -- FK profiles (tech holding it)
  current_project_id    uuid,                          -- FK projects (linked job — NOT free text)

  -- IRA / rope-access gear tracking
  last_inspection_date  date,
  next_calibration_date date,

  accessories           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- kit reconciliation
  notes                 text,

  created_by            uuid,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT tools_pkey PRIMARY KEY (id),
  CONSTRAINT tools_current_holder_id_fkey  FOREIGN KEY (current_holder_id)  REFERENCES public.profiles(id),
  CONSTRAINT tools_current_project_id_fkey FOREIGN KEY (current_project_id) REFERENCES public.projects(id),
  CONSTRAINT tools_created_by_fkey         FOREIGN KEY (created_by)         REFERENCES public.profiles(id)
);


-- 3) LEDGER: tool_transactions ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_transactions (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  tool_id               uuid NOT NULL,

  -- 'retired' added to the recap set so a retire is captured in history too.
  action                text NOT NULL
                          CHECK (action IN ('out','in','maintenance','enrolled','retired')),

  profile_id            uuid,                          -- tech involved in this action
  project_id            uuid,                          -- job the tool went out on
  expected_return_date  date,
  condition             text,                          -- captured on check-in
  photo_url             text,                          -- SharePoint webUrl of condition photo
  note                  text,

  created_by            uuid,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT tool_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT tool_transactions_tool_id_fkey    FOREIGN KEY (tool_id)    REFERENCES public.tools(id) ON DELETE CASCADE,
  CONSTRAINT tool_transactions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT tool_transactions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT tool_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);


-- 4) INDEXES ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tools_status_idx             ON public.tools (status);
CREATE INDEX IF NOT EXISTS tools_current_holder_idx     ON public.tools (current_holder_id);
CREATE INDEX IF NOT EXISTS tools_current_project_idx    ON public.tools (current_project_id);

CREATE INDEX IF NOT EXISTS tool_tx_tool_id_idx          ON public.tool_transactions (tool_id);
CREATE INDEX IF NOT EXISTS tool_tx_tool_created_idx     ON public.tool_transactions (tool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_tx_project_idx          ON public.tool_transactions (project_id);
CREATE INDEX IF NOT EXISTS tool_tx_profile_idx          ON public.tool_transactions (profile_id);


-- 5) updated_at TRIGGER (reuses the existing update_updated_at function) -------
DROP TRIGGER IF EXISTS tools_set_updated_at ON public.tools;
CREATE TRIGGER tools_set_updated_at
  BEFORE UPDATE ON public.tools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- 6) RLS ----------------------------------------------------------------------
-- Reads: any authenticated user (mirrors projects' read model). Writes: none
-- here on purpose — all writes go through project-proxy on the service_role
-- key, which bypasses RLS. No permissive WITH CHECK (true) policy is created.
ALTER TABLE public.tools             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tools_select_authenticated ON public.tools;
CREATE POLICY tools_select_authenticated
  ON public.tools FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tool_tx_select_authenticated ON public.tool_transactions;
CREATE POLICY tool_tx_select_authenticated
  ON public.tool_transactions FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- END 05_tool_control.sql
-- ============================================================================
