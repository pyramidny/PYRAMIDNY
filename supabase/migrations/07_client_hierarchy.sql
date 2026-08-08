-- ============================================================================
-- 07_client_hierarchy.sql   —   DRAFT, FOR REVIEW. DO NOT RUN YET.
-- ============================================================================
-- Pyramid Restoration Staff Portal
-- Supabase project: izjaxmcdlsdkdliqjlei (PYRAMID CLIENT COMMAND)
--
-- Adds Client -> Site -> Project hierarchy plus Contacts.
--
-- ENTIRELY ADDITIVE. No existing column is dropped or altered. All new
-- columns on `projects` are nullable, so nothing breaks and the app keeps
-- working unchanged until the UI ships.
--
-- Confirmed decisions this encodes:
--   * Client = the entity Pyramid bills (matches QuickBooks). One per project.
--   * Contact = anyone else involved (architect, engineer, board, super).
--   * Sites belong to a client and can be REASSIGNED when a building changes
--     management companies. Projects follow the site automatically.
--   * Billing history is protected by qb_customer_job stored verbatim on the
--     project, so a site move never breaks A/R reconciliation.
--   * Files attach at the PROJECT level. Client/site folders are for
--     organization and future client-scoped access.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ENUMS
--    Verified against live enum list — no name collisions.
-- ----------------------------------------------------------------------------
do $$ begin
  create type client_type as enum (
    'managing_agent',
    'owner',
    'architect',
    'engineer',
    'general_contractor',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_type as enum (
    'primary',
    'billing',
    'property_manager',
    'architect',
    'engineer',
    'board_member',
    'superintendent',
    'other'
  );
exception when duplicate_object then null; end $$;


-- ----------------------------------------------------------------------------
-- 2. CLIENTS
-- ----------------------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  client_type       client_type not null default 'managing_agent',

  -- Self-reference for parent/child firms, e.g. Advanced Management Services
  -- is "A Division of Argo Management" in the QuickBooks export.
  parent_client_id  uuid references public.clients(id) on delete set null,

  address_line1     text,
  address_line2     text,
  city              text,
  state             text,
  postal_code       text,
  phone             text,
  email             text,
  website           text,
  notes             text,

  -- Verbatim QuickBooks Desktop customer name. The join key to billing.
  qb_customer_name  text,

  -- Store the driveItem ID, not a path. Paths break on rename; IDs survive
  -- both renames and moves.
  sharepoint_folder_id   text,
  sharepoint_folder_url  text,

  is_active         boolean not null default true,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists clients_name_unique_ci
  on public.clients (lower(name));

create index if not exists clients_type_idx   on public.clients (client_type);
create index if not exists clients_parent_idx on public.clients (parent_client_id);
create index if not exists clients_qb_idx     on public.clients (qb_customer_name);


-- ----------------------------------------------------------------------------
-- 3. SITES  (buildings / job locations)
-- ----------------------------------------------------------------------------
-- client_id is deliberately NOT immutable. Reassigning it is how a building
-- moves to a new management company. Projects under the site follow.
-- The SharePoint folder is moved separately via Graph PATCH on parentReference.
create table if not exists public.sites (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete restrict,

  name            text not null,          -- "200 East 27th Street" or "Victoria House"
  address_line1   text,
  address_line2   text,
  city            text,
  state           text default 'NY',
  postal_code     text,
  borough         text,                   -- Manhattan / Brooklyn / Queens / Bronx / Staten Island
  bin_number      text,                   -- DOB Building Identification Number
  block_lot       text,

  notes           text,

  sharepoint_folder_id   text,
  sharepoint_folder_url  text,

  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Site names are unique WITHIN a client, not globally. 98-01 67th Avenue
-- legitimately exists under both Realty Operation Group and Kings & Queens.
create unique index if not exists sites_client_name_unique_ci
  on public.sites (client_id, lower(name));

create index if not exists sites_client_idx  on public.sites (client_id);
create index if not exists sites_borough_idx on public.sites (borough);


-- ----------------------------------------------------------------------------
-- 4. CONTACTS
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  site_id         uuid references public.sites(id) on delete set null,

  first_name      text,
  last_name       text,
  full_name       text generated always as (
                    trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
                  ) stored,
  title           text,
  email           text,
  phone           text,
  mobile          text,
  contact_type    contact_type not null default 'other',

  -- Future client portal access. All-or-none per project; the visibility rule
  -- itself lives in one place in permissions.js so it can be refined later.
  is_portal_user  boolean not null default false,

  -- Verbatim import of the "Ongoing/Past Projects/PM" column from the
  -- hand-maintained contact sheet. Free text on purpose — not parsed.
  legacy_notes    text,

  notes           text,
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists contacts_client_idx on public.contacts (client_id);
create index if not exists contacts_site_idx   on public.contacts (site_id);
create index if not exists contacts_email_idx  on public.contacts (lower(email));


-- ----------------------------------------------------------------------------
-- 5. PROJECT-LEVEL CONTACTS  (many-to-many)
-- ----------------------------------------------------------------------------
-- A project usually involves several people across different firms. This is
-- what keeps the hierarchy a clean tree while still letting an architect at a
-- different company be attached to the job.
create table if not exists public.project_contacts (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  role_note    text,
  created_at   timestamptz not null default now(),
  unique (project_id, contact_id)
);

create index if not exists project_contacts_project_idx on public.project_contacts (project_id);
create index if not exists project_contacts_contact_idx on public.project_contacts (contact_id);


-- ----------------------------------------------------------------------------
-- 6. PROJECTS — additive columns only
-- ----------------------------------------------------------------------------
alter table public.projects
  add column if not exists client_id  uuid references public.clients(id) on delete set null,
  add column if not exists site_id    uuid references public.sites(id)   on delete set null,

  -- Verbatim QuickBooks "Customer:Job" string. This is the billing join key and
  -- it must NEVER be rewritten, even if the site later moves to another client.
  -- Invoices raised under the old agent stay keyed to the old agent.
  add column if not exists qb_customer_job text,

  -- Populated by the post-migration index pass over the Archives site.
  add column if not exists archive_folder_id  text,
  add column if not exists archive_folder_url text;

create index if not exists projects_client_idx on public.projects (client_id);
create index if not exists projects_site_idx   on public.projects (site_id);
create index if not exists projects_qbjob_idx  on public.projects (qb_customer_job);

-- NOTE: property_manager_owner and architect_engineer are intentionally LEFT
-- IN PLACE and unused. They are the free-text ancestors of clients/contacts.
-- Keep them through this sprint as a safety net; drop in a later migration
-- once clients and contacts hold real data.


-- ----------------------------------------------------------------------------
-- 7. updated_at TRIGGERS  (reuses the existing update_updated_at function)
-- ----------------------------------------------------------------------------
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
  for each row execute function public.update_updated_at();

drop trigger if exists sites_updated_at on public.sites;
create trigger sites_updated_at before update on public.sites
  for each row execute function public.update_updated_at();

drop trigger if exists contacts_updated_at on public.contacts;
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.update_updated_at();


-- ----------------------------------------------------------------------------
-- 8. RLS
--    Matches the existing pattern: authenticated users read, ALL writes go
--    through project-proxy on the service_role key.
-- ----------------------------------------------------------------------------
alter table public.clients          enable row level security;
alter table public.sites            enable row level security;
alter table public.contacts         enable row level security;
alter table public.project_contacts enable row level security;

drop policy if exists clients_select_authenticated on public.clients;
create policy clients_select_authenticated
  on public.clients for select to authenticated using (true);

drop policy if exists sites_select_authenticated on public.sites;
create policy sites_select_authenticated
  on public.sites for select to authenticated using (true);

drop policy if exists contacts_select_authenticated on public.contacts;
create policy contacts_select_authenticated
  on public.contacts for select to authenticated using (true);

drop policy if exists project_contacts_select_authenticated on public.project_contacts;
create policy project_contacts_select_authenticated
  on public.project_contacts for select to authenticated using (true);

-- No INSERT/UPDATE/DELETE policies by design. Writes are proxy-only.


-- ----------------------------------------------------------------------------
-- 9. VERIFY (run after)
-- ----------------------------------------------------------------------------
-- select table_name, column_name, data_type
-- from information_schema.columns
-- where table_schema='public' and table_name in ('clients','sites','contacts')
-- order by table_name, ordinal_position;
--
-- select count(*) as projects_with_client from projects where client_id is not null;


-- ============================================================================
-- DELIBERATELY NOT IN THIS MIGRATION
-- ============================================================================
-- * generate_project_number rewrite — ships Aug 21 with the cutover, not here.
--   Current version does SUBSTRING(project_number FROM 3), which returns 375
--   for 'P11375' and would mint colliding numbers the moment legacy data lands.
-- * can_access_project() changes — the client portal read rule comes later,
--   once the visibility gate is designed.
-- * Dropping the temporary with-check(true) policy on projects_insert — that
--   comes out at go-live, not now.
-- * Dropping property_manager_owner / architect_engineer — safety net for now.
-- ============================================================================
