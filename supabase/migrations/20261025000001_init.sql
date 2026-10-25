-- LookAtMe Research — initial schema (spec §3.2–3.4)
-- Risk labels use the app's Low / Moderate / High (decision in docs/ORIGINAL_APP_MAP.md §9.5).
-- Apply with: supabase db push   (or paste into the Supabase SQL editor)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
create type public.org_type as enum ('school', 'behavioral_dev', 'hospital');
create type public.member_role as enum ('admin', 'staff', 'viewer');

-- ---------------------------------------------------------------- tables
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 1 and 200),
  type             public.org_type not null,
  plan             public.org_type not null,
  screening_quota  int check (screening_quota is null or screening_quota >= 0), -- null = unlimited
  screenings_used  int not null default 0,
  seats            int not null check (seats > 0),
  expires_on       date not null,
  drive_folder_id  text,
  created_at       timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table public.members (
  user_id    uuid not null references auth.users on delete cascade,
  org_id     uuid not null references public.organizations on delete cascade,
  role       public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index members_org_idx on public.members (org_id);

create table public.children (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations on delete cascade,
  code        text not null check (length(code) between 1 and 40),
  birth_month date,
  sex         text check (sex in ('M', 'F', 'U')),
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

create table public.consents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations on delete cascade,
  child_id          uuid not null references public.children on delete cascade,
  guardian_relation text not null,
  consent_version   text not null,
  allow_recording   boolean not null default false,
  allow_research    boolean not null default false,
  signed_at         timestamptz not null default now(),
  withdrawn_at      timestamptz
);
create index consents_child_idx on public.consents (child_id);

create table public.sessions (
  id                    uuid primary key default gen_random_uuid(),
  client_session_id     uuid not null unique,
  org_id                uuid not null references public.organizations on delete cascade,
  child_id              uuid not null references public.children on delete cascade,
  staff_id              uuid references auth.users on delete set null,
  status                text not null default 'started' check (status in ('started', 'completed', 'invalid')),
  engine                text not null default 'mediapipe',
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  calibration_error_px  numeric,
  low_accuracy          boolean not null default false,
  face_found_pct        numeric,
  quality_score         numeric,
  retest_needed         boolean not null default false,
  level1_score          numeric,
  level2_score          numeric,
  level3_score          numeric,
  overall_score         numeric,
  risk_level            text check (risk_level in ('Low', 'Moderate', 'High')),
  results               jsonb,   -- full per-test results (switches, latency, humanSide, …)
  quality               jsonb,   -- quality breakdown (lighting, distance, thresholds used)
  blind                 boolean not null default false,
  created_offline       boolean not null default false
);
create index sessions_org_idx on public.sessions (org_id, started_at desc);
create index sessions_child_idx on public.sessions (child_id);

create table public.session_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations on delete cascade,
  session_id     uuid not null references public.sessions on delete cascade,
  kind           text not null check (kind in ('gaze_csv', 'recording')),
  location       text not null check (location in ('supabase', 'google_drive', 'local_only')),
  path           text,
  drive_file_id  text,
  size_bytes     bigint,
  created_at     timestamptz not null default now(),
  unique (session_id, kind)
);

create table public.diagnoses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations on delete cascade,
  child_id      uuid not null references public.children on delete cascade,
  result        text not null check (result in ('asd', 'not_asd', 'other', 'pending')),
  diagnosed_on  date,
  recorded_by   uuid references auth.users on delete set null,
  created_at    timestamptz not null default now()
);

create table public.drive_connections (
  org_id             uuid primary key references public.organizations on delete cascade,
  google_email       text,
  refresh_token_enc  text,
  status             text not null default 'active' check (status in ('active', 'needs_reconnect', 'revoked')),
  connected_by       uuid references auth.users on delete set null,
  connected_at       timestamptz not null default now(),
  last_error         text
);

create table public.audit_log (
  id       bigserial primary key,
  org_id   uuid references public.organizations on delete cascade,
  user_id  uuid references auth.users on delete set null,
  action   text not null,
  target   text,
  at       timestamptz not null default now()
);
create index audit_org_idx on public.audit_log (org_id, at desc);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where org_id = o and user_id = auth.uid());
$$;

create or replace function public.has_role(o uuid, roles public.member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where org_id = o and user_id = auth.uid() and role = any (roles));
$$;

-- Storage paths are "<org_id>/<file>"; returns null for malformed paths instead of raising.
create or replace function public.path_org(p text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- "<org_id>/<session_id>.csv" -> session id, or null.
create or replace function public.path_session(p text) returns uuid
language plpgsql immutable as $$
begin
  if p !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.csv$' then return null; end if;
  return split_part(split_part(p, '/', 2), '.', 1)::uuid;
exception when others then
  return null;
end $$;

-- Can the caller read this session's files? Members of the org, except blind sessions (admins only).
-- SECURITY DEFINER so the check sees blind sessions that RLS hides from the caller.
create or replace function public.can_read_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and public.is_member(s.org_id)
      and (not s.blind or public.has_role(s.org_id, '{admin}'))
  );
$$;

-- Can the caller write the gaze file at this path? Only "<org>/<session>.csv" for a session of that org
-- that the caller ran (or any session, for org admins).
create or replace function public.can_write_gaze(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s
    where s.id = public.path_session(p_name)
      and s.org_id = public.path_org(p_name)
      and (
        (s.staff_id = auth.uid() and public.has_role(s.org_id, '{admin,staff}'))
        or public.has_role(s.org_id, '{admin}')
      )
  );
$$;

-- A child can never move to another organization (its consents, sessions and files stay with the old one).
create or replace function public.children_keep_org() returns trigger
language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id then raise exception 'org_change_not_allowed'; end if;
  return new;
end $$;

-- Seat limit, enforced in the database (serialised per organization, so parallel invites can't exceed it).
create or replace function public.members_seat_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_seats int; v_count int;
begin
  select seats into v_seats from public.organizations where id = new.org_id for update;
  select count(*) into v_count from public.members where org_id = new.org_id;
  if v_count >= v_seats then raise exception 'seats_full'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.organizations     enable row level security;
alter table public.platform_admins   enable row level security;
alter table public.members           enable row level security;
alter table public.children          enable row level security;
alter table public.consents          enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_files     enable row level security;
alter table public.diagnoses         enable row level security;
alter table public.drive_connections enable row level security;  -- no policies: server (service role) only
alter table public.audit_log         enable row level security;

create policy org_select on public.organizations for select to authenticated using (public.is_member(id));

create policy members_select on public.members for select to authenticated using (public.is_member(org_id));

create policy children_select on public.children for select to authenticated using (public.is_member(org_id));
create policy children_insert on public.children for insert to authenticated
  with check (public.has_role(org_id, '{admin,staff}'));
create policy children_update on public.children for update to authenticated
  using (public.has_role(org_id, '{admin,staff}')) with check (public.has_role(org_id, '{admin,staff}'));

create policy consents_select on public.consents for select to authenticated using (public.is_member(org_id));
create policy consents_insert on public.consents for insert to authenticated
  with check (
    public.has_role(org_id, '{admin,staff}')
    and exists (select 1 from public.children c where c.id = child_id and c.org_id = consents.org_id)
  );

create policy sessions_select on public.sessions for select to authenticated
  using (public.is_member(org_id) and (not blind or public.has_role(org_id, '{admin}')));

create policy session_files_select on public.session_files for select to authenticated
  using (public.can_read_session(session_id));

create policy diagnoses_select on public.diagnoses for select to authenticated
  using (public.has_role(org_id, '{admin,staff}'));
create policy diagnoses_insert on public.diagnoses for insert to authenticated
  with check (
    public.has_role(org_id, '{admin,staff}')
    and exists (select 1 from public.children c where c.id = child_id and c.org_id = diagnoses.org_id)
  );

create policy audit_select on public.audit_log for select to authenticated using (public.has_role(org_id, '{admin}'));

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('gaze', 'gaze', false) on conflict (id) do nothing;

create policy gaze_read on storage.objects for select to authenticated
  using (bucket_id = 'gaze' and public.can_read_session(public.path_session(name)));
create policy gaze_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'gaze' and public.can_write_gaze(name));
-- needed for upsert (re-saving a session's gaze CSV after a failed save)
create policy gaze_update on storage.objects for update to authenticated
  using (bucket_id = 'gaze' and public.can_write_gaze(name))
  with check (bucket_id = 'gaze' and public.can_write_gaze(name));

create trigger children_keep_org before update on public.children
  for each row execute function public.children_keep_org();
create trigger members_seat_check before insert on public.members
  for each row execute function public.members_seat_check();

-- ---------------------------------------------------------------- RPCs
-- Starts a screening: checks role, plan expiry, quota and consent. Idempotent on p_client_session_id.
create or replace function public.start_session(p_child uuid, p_client_session_id uuid, p_engine text default 'mediapipe')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; o public.organizations; v_id uuid;
begin
  select id into v_id from public.sessions where client_session_id = p_client_session_id;
  if v_id is not null then
    if not public.has_role((select org_id from public.sessions where id = v_id), '{admin,staff}') then
      raise exception 'not_allowed';
    end if;
    return v_id;
  end if;

  select org_id into v_org from public.children where id = p_child;
  if v_org is null or not public.has_role(v_org, '{admin,staff}') then raise exception 'not_allowed'; end if;

  select * into o from public.organizations where id = v_org;
  if o.expires_on < current_date then raise exception 'plan_expired'; end if;
  if o.screening_quota is not null and o.screenings_used >= o.screening_quota then raise exception 'quota_reached'; end if;
  if not exists (
    select 1 from public.consents where child_id = p_child and org_id = v_org and withdrawn_at is null
  ) then
    raise exception 'no_consent';
  end if;

  insert into public.sessions (client_session_id, org_id, child_id, staff_id, engine)
  values (p_client_session_id, v_org, p_child, auth.uid(), coalesce(p_engine, 'mediapipe'))
  returning id into v_id;
  return v_id;
end $$;

-- Finishes a screening. Quota is used only on the first transition to 'completed';
-- sessions flagged retest_needed become 'invalid' and do not use quota. Idempotent.
create or replace function public.complete_session(p_session uuid, p_data jsonb, p_gaze_path text default null)
returns text language plpgsql security definer set search_path = public as $$
declare s public.sessions; v_status text; v_risk text;
begin
  select * into s from public.sessions where id = p_session for update;
  if s.id is null
     or not (
       (s.staff_id = auth.uid() and public.has_role(s.org_id, '{admin,staff}'))
       or public.has_role(s.org_id, '{admin}')
     ) then
    raise exception 'not_allowed';
  end if;

  if p_gaze_path is not null then
    if p_gaze_path <> s.org_id::text || '/' || s.id::text || '.csv' then raise exception 'bad_path'; end if;
    insert into public.session_files (org_id, session_id, kind, location, path, size_bytes)
    values (s.org_id, s.id, 'gaze_csv', 'supabase', p_gaze_path, nullif(p_data->>'gaze_bytes', '')::bigint)
    on conflict (session_id, kind) do update set path = excluded.path, size_bytes = excluded.size_bytes;
  end if;

  if s.status <> 'started' then return s.status; end if;

  v_risk := p_data->>'risk_level';
  if v_risk is not null and v_risk not in ('Low', 'Moderate', 'High') then raise exception 'bad_risk_level'; end if;
  v_status := case when coalesce((p_data->>'retest_needed')::boolean, false) then 'invalid' else 'completed' end;

  update public.sessions set
    status               = v_status,
    completed_at         = now(),
    calibration_error_px = nullif(p_data->>'calibration_error_px', '')::numeric,
    low_accuracy         = coalesce((p_data->>'low_accuracy')::boolean, false),
    face_found_pct       = nullif(p_data->>'face_found_pct', '')::numeric,
    quality_score        = nullif(p_data->>'quality_score', '')::numeric,
    retest_needed        = coalesce((p_data->>'retest_needed')::boolean, false),
    level1_score         = nullif(p_data->>'level1_score', '')::numeric,
    level2_score         = nullif(p_data->>'level2_score', '')::numeric,
    level3_score         = nullif(p_data->>'level3_score', '')::numeric,
    overall_score        = nullif(p_data->>'overall_score', '')::numeric,
    risk_level           = v_risk,
    results              = p_data->'results',
    quality              = p_data->'quality'
  where id = s.id;

  if v_status = 'completed' then
    update public.organizations set screenings_used = screenings_used + 1 where id = s.org_id;
  end if;
  return v_status;
end $$;

-- Lets members write an audit entry for their own org (views, exports). No child data in p_target.
create or replace function public.log_action(p_org uuid, p_action text, p_target text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_org) then raise exception 'not_allowed'; end if;
  if p_action not in ('view_session', 'export_sessions_csv', 'export_gaze_csv') then raise exception 'bad_action'; end if;
  insert into public.audit_log (org_id, user_id, action, target) values (p_org, auth.uid(), left(p_action, 60), left(p_target, 200));
end $$;

revoke all on function public.start_session(uuid, uuid, text) from public, anon;
revoke all on function public.complete_session(uuid, jsonb, text) from public, anon;
revoke all on function public.log_action(uuid, text, text) from public, anon;
grant execute on function public.start_session(uuid, uuid, text) to authenticated;
grant execute on function public.complete_session(uuid, jsonb, text) to authenticated;
grant execute on function public.log_action(uuid, text, text) to authenticated;
