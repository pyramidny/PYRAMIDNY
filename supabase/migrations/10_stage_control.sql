-- ============================================================================
-- Migration 10 — Stage control (Phase 1)
-- Project: izjaxmcdlsdkdliqjlei  (PYRAMID CLIENT COMMAND)
-- Date:    2026-08-08
--
-- Locks in the TWO-AXIS model:
--   current_stage (1..6) = workflow position, admin-driven (Advance / Back / override)
--   status (project_status enum) = business / outcome label, INDEPENDENT
--
-- This migration does four things:
--   1. Creates public.stages — labels live in the DB, renamable/extendable to 10
--      later with no deploy. Seeds the current 6.
--   2. DECOUPLES stage from status: drops the sync_stage_on_status trigger, so
--      changing status no longer moves the stage bar (and vice versa). New
--      projects still start at Stage 1 (column default + backfill).
--   3. LOOP-PROVISION: handle_stage_advance now provisions every stage up to the
--      new one, so an admin override that jumps forward never skips tasks.
--      provision_stage_tasks is idempotent, so a retreat is a harmless no-op and
--      nothing ever duplicates.
--   4. SUPERSEDES migration 09: the award gate + prospect->client promote move
--      from status-strings onto current_stage >= 3 — the axis that now drives award.
--
-- Applied MANUALLY in the SQL Editor. Verify the project slug first.
--
-- STATUS: APPLIED & VERIFIED in production 2026-08-08.
--   Test returned: gate=t | promote=client | tasks_1to3=15 (7+3+5).
--   NOTE: provision_stage_tasks takes (uuid, smallint) — the loop var is integer
--   in plpgsql, so it MUST be cast (s::smallint) or resolution fails.
-- ============================================================================


-- ── 1. STAGES label table ───────────────────────────────────────────────────
create table if not exists public.stages (
  stage_number smallint    primary key,
  key          text        not null unique,
  label        text        not null,
  sort_order   smallint    not null default 0,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Labels preserved from the shipped frontend map. Editable here anytime with no
-- deploy. (Note: 'Transfer' / 'Active' don't obviously match their task content —
-- rename freely once you and Jorge settle wording.)
insert into public.stages (stage_number, key, label, sort_order) values
  (1, 'bidding',   'Bidding',   1),
  (2, 'interview', 'Interview', 2),
  (3, 'awarded',   'Awarded',   3),
  (4, 'transfer',  'Transfer',  4),
  (5, 'active',    'Active',    5),
  (6, 'closeout',  'Closeout',  6)
on conflict (stage_number) do nothing;

alter table public.stages enable row level security;
drop policy if exists stages_read on public.stages;
create policy stages_read on public.stages
  for select to authenticated using (true);
-- No write policy => writes are service_role (proxy) only, mirroring projects.


-- ── 2. DECOUPLE stage from status ───────────────────────────────────────────
-- Stage is now driven only by the admin control, not by status edits.
drop trigger if exists sync_stage_on_status on public.projects;
-- function sync_stage_from_status() left in place, now unused (safe to drop later).

-- Now that sync won't set it, guarantee a sane starting stage.
alter table public.projects alter column current_stage set default 1;
update public.projects set current_stage = 1 where current_stage is null;


-- ── 3. LOOP-PROVISION on stage change ───────────────────────────────────────
create or replace function public.handle_stage_advance()
returns trigger
language plpgsql
as $$
declare s integer;   -- FOR-loop var is always integer in plpgsql; cast at the call
begin
  if NEW.current_stage is distinct from OLD.current_stage then
    -- Provision every stage up to the new one. Idempotent: forward jumps fill
    -- any skipped stages; a retreat re-scans lower stages and inserts nothing.
    for s in 1 .. NEW.current_stage loop
      perform provision_stage_tasks(NEW.id, s::smallint);
    end loop;
  end if;
  return NEW;
end;
$$;
-- Existing trigger on_stage_advance (AFTER UPDATE OF current_stage) is unchanged;
-- it now runs this smarter body.


-- ── 4. SUPERSEDE migration 09 — gate + promote key off current_stage ────────
-- Drop the status-keyed versions from migration 09.
drop trigger  if exists enforce_award_requirements    on public.projects;
drop function if exists public.enforce_award_requirements();
drop trigger  if exists auto_promote_client_on_award  on public.projects;
drop function if exists public.auto_promote_client_on_award();

-- GATE: block reaching Stage 3 (Awarded) or beyond without a Client + Job Site.
create or replace function public.enforce_award_requirements()
returns trigger
language plpgsql
as $$
begin
  if NEW.current_stage >= 3 then
    if NEW.client_id is null or NEW.site_id is null then
      raise exception
        'Cannot advance to Stage 3 (Awarded) or beyond: a Client and Job Site are required. Missing: %.',
        concat_ws(' and ',
          case when NEW.client_id is null then 'Client'   end,
          case when NEW.site_id   is null then 'Job Site' end)
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_award_requirements on public.projects;
create trigger enforce_award_requirements
  before insert or update of current_stage on public.projects
  for each row execute function public.enforce_award_requirements();

-- PROMOTE: prospect -> client on reaching Stage 3+, idempotent.
create or replace function public.auto_promote_client_on_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.current_stage >= 3
     and NEW.current_stage is distinct from OLD.current_stage
     and NEW.client_id is not null then
    update public.clients
       set relationship_status = 'client', updated_at = now()
     where id = NEW.client_id and relationship_status = 'prospect';
  end if;
  return NEW;
end;
$$;

drop trigger if exists auto_promote_client_on_award on public.projects;
create trigger auto_promote_client_on_award
  after insert or update of current_stage on public.projects
  for each row execute function public.auto_promote_client_on_award();


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- select stage_number, label from public.stages order by stage_number;
-- select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid='public.projects'::regclass and not tgisinternal order by tgname;


-- ============================================================================
-- TEST — self-contained, ROLLS BACK. Paste and run as a block.
-- Expect (as a red error, which is the intended output vehicle):
--   gate(want t): t   promote(want client): client   tasks_1to3(want >0): <n>
-- ============================================================================
-- begin;
-- do $test$
-- declare c_id uuid; s_id uuid; p_id uuid; gate boolean:=false; promoted text; ntasks int;
-- begin
--   insert into clients (name, client_type, relationship_status)
--     values ('ZZ_STAGE_TEST','managing_agent','prospect') returning id into c_id;
--   insert into sites (client_id, name)
--     values (c_id,'ZZ_STAGE_SITE') returning id into s_id;
--   insert into projects (project_address, division, status, client_id)
--     values ('ZZ stage test','regular','New Bid', c_id) returning id into p_id;
--
--   begin
--     update projects set current_stage=3 where id=p_id;   -- no site: must block
--   exception when others then gate:=true; end;
--
--   update projects set site_id=s_id where id=p_id;
--   update projects set current_stage=3 where id=p_id;      -- pass + promote + provision 1..3
--   select relationship_status into promoted from clients where id=c_id;
--   select count(*) into ntasks from project_tasks
--     where project_id=p_id and stage_number<=3;
--
--   raise exception E'gate(want t):%   promote(want client):%   tasks_1to3(want >0):%',
--     gate, promoted, ntasks;
-- end; $test$;
-- rollback;
