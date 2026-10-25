-- Phase 4 (agent A): one screen recording per level (spec §4.4).
-- session_files was unique on (session_id, kind); a screening has 3 levels, so 3 recordings.
-- level = 0 for whole-session files (the gaze CSV); 1..3 for per-level recordings.

alter table public.session_files add column if not exists level int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'session_files_level_check') then
    alter table public.session_files add constraint session_files_level_check check (level between 0 and 3);
  end if;
  alter table public.session_files drop constraint if exists session_files_session_id_kind_key;
  if not exists (select 1 from pg_constraint where conname = 'session_files_session_kind_level_key') then
    alter table public.session_files
      add constraint session_files_session_kind_level_key unique (session_id, kind, level);
  end if;
  -- A Drive file belongs to one row only.
  if not exists (select 1 from pg_constraint where conname = 'session_files_drive_location_check') then
    alter table public.session_files add constraint session_files_drive_location_check
      check (location <> 'google_drive' or drive_file_id is not null);
  end if;
end $$;

-- Same as 20261025000001_init.sql, except the gaze CSV upsert targets (session_id, kind, level).
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
    insert into public.session_files (org_id, session_id, kind, level, location, path, size_bytes)
    values (s.org_id, s.id, 'gaze_csv', 0, 'supabase', p_gaze_path, nullif(p_data->>'gaze_bytes', '')::bigint)
    on conflict (session_id, kind, level) do update set path = excluded.path, size_bytes = excluded.size_bytes;
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

revoke all on function public.complete_session(uuid, jsonb, text) from public, anon;
grant execute on function public.complete_session(uuid, jsonb, text) to authenticated;
