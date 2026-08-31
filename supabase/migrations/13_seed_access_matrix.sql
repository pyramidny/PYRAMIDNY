-- ============================================================================
-- 13_seed_access_matrix.sql  —  Load Jorge's confirmed permission matrix
-- App: Pyramid Restoration Staff Portal (app.pyramidny.com)
-- Org/Project: izjaxmcdlsdkdliqjlei  (PYRAMID CLIENT COMMAND)
--
-- RUN AFTER 12_role_model_jorge8.sql. Run in: Supabase SQL Editor.
--
-- Confirmed by Bill 2026-08-31 (the 10 role changes, incl. three Admin
-- demotions). Sources: Jorge's permission matrix + the M365 user export.
--
-- WHAT THIS DOES NOT TOUCH — all deliberate:
--
--   division   Left exactly as-is. Several people already have Regular/IRA set
--              in Team Management and the matrix has no division column, so
--              there is nothing here to write that wouldn't be a guess.
--              NULL already means "Both / All Divisions" app-wide.
--
--   Victor Ortiz   HELD. The portal has vortiz@pyramidny.com; M365 says his UPN
--              is vsortiz@pyramidny.com. He has never logged in, which is what
--              a non-matching address looks like. Since email is the whitelist
--              key, fixing this is a new row + retire the old one, not an
--              update — so it waits for confirmation rather than writing a
--              second broken row.
--
--   Belarminio Peralta, Lola Berisha, Luis Reyes, Martin Guzman
--              HELD. Live in the portal, absent from Jorge's matrix AND from
--              the M365 export, none has ever logged in. Luis Reyes currently
--              holds Admin. Pending Jorge.
--
-- FLAGGED, APPLIED ANYWAY: Jesus Cruz is seeded at jcruz@pyramidny.com, which
-- is his working, currently-Active login. M365 lists his UPN as
-- purchasing@pyramidny.com. If the UPN is the one that must win, he needs the
-- same new-row-and-retire treatment as Victor.
-- ============================================================================

BEGIN;

CREATE TEMPORARY TABLE _seed (
  email          text PRIMARY KEY,
  role           text NOT NULL,
  tool_access    text NOT NULL,
  billing_access text NOT NULL
) ON COMMIT DROP;

--            email                        base role                 tool     billing
INSERT INTO _seed VALUES
  ('jgarcia@pyramidny.com',    'admin',                  'admin', 'admin'),  -- Principal / PM
  ('nlee@pyramidny.com',       'admin',                  'tech',  'admin'),  -- Office Manager
  ('ovilla@pyramidny.com',     'admin',                  'none',  'none'),   -- Director of Design
  ('oortiz@pyramidny.com',     'admin',                  'none',  'view'),   -- CHANGE: sales_rep -> admin
  ('jcruz@pyramidny.com',      'project_manager',        'admin', 'admin'),  -- CHANGE: admin -> PM
  ('lzyma@pyramidny.com',      'overseer',               'none',  'none'),   -- CHANGE: director -> overseer
  ('pmartinez@pyramidny.com',  'overseer',               'none',  'none'),   -- CHANGE: task_mgr -> overseer
  ('ahigginson@pyramidny.com', 'overseer',               'none',  'none'),   -- CHANGE: task_mgr -> overseer
  ('nsantos@pyramidny.com',    'overseer',               'none',  'admin'),  -- CHANGE: admin -> overseer
  ('fsuriani@pyramidny.com',   'director_of_operations', 'none',  'view'),   -- Director of Operations
  ('abaniya@pyramidny.com',    'task_manager',           'none',  'view'),   -- CHANGE: admin -> task_mgr
  ('ppatel@pyramidny.com',     'project_manager',        'none',  'view'),
  ('sdelacruz@pyramidny.com',  'director_of_operations', 'none',  'view'),   -- CHANGE: est_coord -> director
  ('tgonzalez@pyramidny.com',  'task_manager',           'none',  'view'),   -- CHANGE: PM -> task_mgr
  ('mholguin@pyramidny.com',   'estimator',              'none',  'none'),
  ('ghurtado@pyramidny.com',   'project_manager',        'none',  'none'),   -- blank in matrix; already live as PM/IRA
  ('jpolicarpio@pyramidny.com','task_manager',           'none',  'view');   -- CHANGE: PM -> task_mgr


-- ---------------------------------------------------------------------------
-- Apply to existing people.
--
-- profiles.role is a user_role enum; staff_whitelist.role may be either the
-- enum or plain text depending on when it was created, so that one is applied
-- through dynamic SQL keyed off the column's actual type. Cheaper than being
-- wrong on a live table.
-- ---------------------------------------------------------------------------

UPDATE public.profiles p
   SET role           = s.role::public.user_role,
       tool_access    = s.tool_access,
       billing_access = s.billing_access,
       updated_at     = now()
  FROM _seed s
 WHERE lower(p.email) = s.email;

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT udt_name INTO col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'staff_whitelist'
     AND column_name  = 'role';

  EXECUTE format(
    'UPDATE public.staff_whitelist w
        SET role = s.role::%s, tool_access = s.tool_access, billing_access = s.billing_access
       FROM _seed s
      WHERE lower(w.email) = s.email',
    CASE WHEN col_type = 'user_role' THEN 'public.user_role' ELSE 'text' END
  );
END $$;


-- ---------------------------------------------------------------------------
-- New invitations. Whitelist rows only — the profile materialises on their
-- first Azure AD login via handle_new_user_from_whitelist. Emails come from the
-- M365 export, which is authoritative.
--
-- Warehouse is the shared tool-crib mailbox, not a person: lowest base role
-- plus the Tool Tech hat. This is exactly the case the hat model exists for —
-- it needed no base role in Jorge's matrix because tool access was never a role
-- to begin with.
--
-- Division is left NULL (= Both) on all six; set per-person in Team Management.
-- ---------------------------------------------------------------------------

INSERT INTO public.staff_whitelist
  (email, full_name, display_name, role, division, title, tool_access, billing_access, is_active)
VALUES
  ('cgarcia@pyramidny.com',  'Claudia Garcia',  'Claudia',  'overseer',        NULL, NULL,               'none', 'admin', true),
  ('dking@pyramidny.com',    'Dan King',        'Dan',      'project_manager', NULL, 'Project Manager',  'none', 'view',  true),
  ('rsaez@pyramidny.com',    'Ricardo Saez',    'Ricardo',  'project_manager', NULL, 'Project Manager',  'none', 'view',  true),
  ('jmoran@pyramidny.com',   'Jair Moran',      'Jair',     'estimator',       NULL, 'Estimator',        'none', 'none',  true),
  ('kpawlak@pyramidny.com',  'Kris Pawlak',     'Kris',     'estimator',       NULL, 'Estimator',        'none', 'none',  true),
  ('wh@pyramidny.com',       'Warehouse',       'Warehouse','field_crew',      NULL, 'Shared tool crib', 'tech', 'none',  true)
ON CONFLICT (email) DO UPDATE
  SET role           = EXCLUDED.role,
      tool_access    = EXCLUDED.tool_access,
      billing_access = EXCLUDED.billing_access,
      -- Unqualified table name: Postgres rejects a schema-qualified reference
      -- to the conflict target inside DO UPDATE.
      title          = COALESCE(staff_whitelist.title, EXCLUDED.title),
      is_active      = true;

COMMIT;


-- ---------------------------------------------------------------------------
-- Verification — run after COMMIT.
-- ---------------------------------------------------------------------------

-- Every seeded person, as they now stand.
SELECT email, full_name, role::text AS role, COALESCE(division::text,'both') AS division,
       tool_access, billing_access
  FROM public.profiles
 WHERE is_active
 ORDER BY role::text, full_name;

-- Should return only the four held people (+ Bill's test/admin accounts).
-- Anyone else here means the seed missed a row.
SELECT email, full_name, role::text AS role, tool_access, billing_access
  FROM public.profiles
 WHERE is_active
   AND lower(email) NOT IN (
     'jgarcia@pyramidny.com','nlee@pyramidny.com','ovilla@pyramidny.com',
     'oortiz@pyramidny.com','jcruz@pyramidny.com','lzyma@pyramidny.com',
     'pmartinez@pyramidny.com','ahigginson@pyramidny.com','nsantos@pyramidny.com',
     'fsuriani@pyramidny.com','abaniya@pyramidny.com','ppatel@pyramidny.com',
     'sdelacruz@pyramidny.com','tgonzalez@pyramidny.com','mholguin@pyramidny.com',
     'ghurtado@pyramidny.com','jpolicarpio@pyramidny.com'
   )
 ORDER BY full_name;

-- EXPECTED AFTER THIS SEED:  admins 6 · billing_admins 3 · tool_hats 3
--
-- These count `profiles` only, so they are NOT the numbers on the Team screen.
-- Eleven people have never logged in and exist as whitelist rows with no
-- profile yet; the Team screen merges both, so it shows more. In particular
-- Noemi Santos is demoted off Admin by this seed but has no profile, so she
-- doesn't move this number — and Luis Reyes keeps Admin because he is
-- deliberately not in this seed at all.
--
-- On the Team screen the admin count goes 9 -> 7 (Aashtha, Jesus and Noemi
-- come off; Olivia goes on).
SELECT COUNT(*) FILTER (WHERE role::text = 'admin')        AS admins,
       COUNT(*) FILTER (WHERE billing_access = 'admin')    AS billing_admins,
       COUNT(*) FILTER (WHERE tool_access <> 'none')       AS tool_hats
  FROM public.profiles
 WHERE is_active;
