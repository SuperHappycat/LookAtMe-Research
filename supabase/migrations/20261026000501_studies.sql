-- Multi-site studies (agent D, Phase 5). Builds on the Wave 0 tables `studies` and `study_sites`.
--
-- Users still have NO direct write policies on studies / study_sites / study_invites. Every change goes through
-- the SECURITY DEFINER functions below, which check the caller's role and the org's plan first.
-- Orgs never list each other: a site joins only by redeeming a one-time code that the lead admin passes on
-- out of band. Only the code's SHA-256 hash is stored.

-- ---------------------------------------------------------------- columns / tables
-- Turned on by the SITE's admin: allows the lead to export coded rows (consented children only).
alter table public.study_sites add column if not exists share_row_data boolean not null default false;

create table if not exists public.study_invites (
  id           uuid primary key default gen_random_uuid(),
  study_id     uuid not null references public.studies on delete cascade,
  code_hash    text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  used_by_org  uuid references public.organizations on delete set null,
  used_at      timestamptz
);
create index if not exists study_invites_study_idx on public.study_invites (study_id);
alter table public.study_invites enable row level security;  -- no policies: RPCs / service role only

-- Failed code redemptions, for a per-org rate limit (rows only, no codes).
create table if not exists public.study_join_attempts (
  id      bigserial primary key,
  org_id  uuid not null references public.organizations on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists study_join_attempts_org_idx on public.study_join_attempts (org_id, at desc);
alter table public.study_join_attempts enable row level security;  -- no policies

create index if not exists sessions_study_idx on public.sessions (study_id) where study_id is not null;

-- ---------------------------------------------------------------- helpers
-- Mirrors lib/research/plans.ts (`multi_site` is in the hospital plan only; tests/studies.test.ts keeps them in
-- sync). Expired plans can't create, invite or join.
create or replace function public.org_has_multi_site(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.plan = 'hospital' and o.expires_on >= current_date
  );
$$;

-- Codes: upper-case, separators removed. Same rule as normalizeInviteCode() in lib/research/studies/codes.ts.
-- pgcrypto lives in the `extensions` schema on Supabase, hence the search_path.
create or replace function public.study_code_hash(p_code text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------- create a study
create or replace function public.create_study(p_org uuid, p_name text, p_blind boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.has_role(p_org, '{admin}') then raise exception 'not_allowed'; end if;
  if not public.org_has_multi_site(p_org) then raise exception 'feature_not_in_plan'; end if;
  if length(v_name) not between 1 and 200 then raise exception 'bad_name'; end if;
  insert into public.studies (name, lead_org_id, created_by, blind_default)
  values (v_name, p_org, auth.uid(), coalesce(p_blind, false))
  returning id into v_id;
  insert into public.study_sites (study_id, org_id, status, joined_at) values (v_id, p_org, 'active', now());
  return v_id;
end $$;

-- ---------------------------------------------------------------- invite codes
-- Returns the plain code ONCE (12 characters from a 31-letter alphabet without 0/O, 1/I/L: about 59 bits).
-- Only its SHA-256 hash is stored.
create or replace function public.create_study_invite(p_study uuid, p_days int default 14)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_lead uuid;
  v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text := '';
  v_bytes bytea;
  v_b int;
  i int;
begin
  select lead_org_id into v_lead from public.studies where id = p_study;
  if v_lead is null or not public.has_role(v_lead, '{admin}') then raise exception 'not_allowed'; end if;
  if not public.org_has_multi_site(v_lead) then raise exception 'feature_not_in_plan'; end if;
  if (select count(*) from public.study_invites
      where study_id = p_study and used_at is null and expires_at > now()) >= 20 then
    raise exception 'too_many_invites';
  end if;
  while length(v_code) < 12 loop
    v_bytes := gen_random_bytes(32);
    for i in 0 .. 31 loop
      v_b := get_byte(v_bytes, i);
      -- rejection sampling: 248 = 31 * 8, so every letter is equally likely
      if v_b < 248 and length(v_code) < 12 then
        v_code := v_code || substr(v_alpha, (v_b % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  insert into public.study_invites (study_id, code_hash, expires_at, created_by)
  values (p_study, public.study_code_hash(v_code),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 14), 30))), auth.uid());
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end $$;

-- Lead admin: stop an unused code from working.
create or replace function public.revoke_study_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  select s.lead_org_id into v_lead
  from public.study_invites i join public.studies s on s.id = i.study_id where i.id = p_invite;
  if v_lead is null or not public.has_role(v_lead, '{admin}') then raise exception 'not_allowed'; end if;
  update public.study_invites set expires_at = least(expires_at, now()) where id = p_invite and used_at is null;
end $$;

-- Admin of another org redeems a code. Returns the study id, or NULL for any unusable code (unknown, used by
-- another org, expired): one answer for all three, so the result tells nothing about other studies.
-- The lookup is by hash, so response time does not depend on how much of a code is right.
-- Failures are recorded (the function returns instead of raising so the record is kept); more than 10 failures
-- in an hour blocks the org for the rest of that hour.
create or replace function public.redeem_study_invite(p_code text, p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv public.study_invites; v_lead uuid; v_status text;
begin
  if not public.has_role(p_org, '{admin}') then raise exception 'not_allowed'; end if;
  if not public.org_has_multi_site(p_org) then raise exception 'feature_not_in_plan'; end if;
  perform pg_advisory_xact_lock(hashtext('study_join:' || p_org::text));
  if (select count(*) from public.study_join_attempts
      where org_id = p_org and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;

  select * into v_inv from public.study_invites where code_hash = public.study_code_hash(p_code) for update;

  -- Retry by the org that already used this code: same answer as the first time.
  if v_inv.id is not null and v_inv.used_by_org = p_org then return v_inv.study_id; end if;

  if v_inv.id is null or v_inv.used_at is not null or v_inv.expires_at <= now() then
    insert into public.study_join_attempts (org_id) values (p_org);
    return null;
  end if;

  select lead_org_id into v_lead from public.studies where id = v_inv.study_id;
  select status into v_status from public.study_sites where study_id = v_inv.study_id and org_id = p_org;
  -- Already in the study: don't use up the code.
  if v_lead = p_org or v_status = 'active' then return v_inv.study_id; end if;

  insert into public.study_sites (study_id, org_id, status, joined_at, share_row_data)
  values (v_inv.study_id, p_org, 'active', now(), false)
  on conflict (study_id, org_id) do update set status = 'active', joined_at = now(), share_row_data = false;
  update public.study_invites set used_by_org = p_org, used_at = now() where id = v_inv.id;
  return v_inv.study_id;
end $$;

-- ---------------------------------------------------------------- leave / remove / share
-- Site admin leaves. The lead can't leave its own study. Row sharing is switched off.
create or replace function public.leave_study(p_study uuid, p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_org, '{admin}') then raise exception 'not_allowed'; end if;
  if exists (select 1 from public.studies where id = p_study and lead_org_id = p_org) then
    raise exception 'lead_cannot_leave';
  end if;
  update public.study_sites set status = 'left', share_row_data = false
  where study_id = p_study and org_id = p_org and status <> 'left';
  if not found then raise exception 'not_a_site'; end if;
end $$;

-- Lead admin removes a site.
create or replace function public.remove_study_site(p_study uuid, p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  select lead_org_id into v_lead from public.studies where id = p_study;
  if v_lead is null or not public.has_role(v_lead, '{admin}') then raise exception 'not_allowed'; end if;
  if p_org = v_lead then raise exception 'lead_cannot_leave'; end if;
  update public.study_sites set status = 'left', share_row_data = false
  where study_id = p_study and org_id = p_org and status <> 'left';
  if not found then raise exception 'not_a_site'; end if;
end $$;

-- Only the site's own admin decides whether its coded rows may be exported to the lead.
create or replace function public.set_study_share_row_data(p_study uuid, p_org uuid, p_share boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_org, '{admin}') then raise exception 'not_allowed'; end if;
  update public.study_sites set share_row_data = coalesce(p_share, false)
  where study_id = p_study and org_id = p_org and status = 'active';
  if not found then raise exception 'not_a_site'; end if;
end $$;

-- ---------------------------------------------------------------- tag sessions
-- Admin/staff of the session's org. A study can be set only if that org is the lead or an active site.
-- Blind sessions follow the blind rule (admins only). p_study null removes the tag.
create or replace function public.set_session_study(p_session uuid, p_study uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_blind boolean;
begin
  select org_id, blind into v_org, v_blind from public.sessions where id = p_session for update;
  if v_org is null or not public.has_role(v_org, '{admin,staff}') then raise exception 'not_allowed'; end if;
  if v_blind and not public.has_role(v_org, '{admin}') then raise exception 'not_allowed'; end if;
  if p_study is not null
     and not exists (select 1 from public.studies where id = p_study and lead_org_id = v_org)
     and not exists (select 1 from public.study_sites where study_id = p_study and org_id = v_org and status = 'active')
  then
    raise exception 'not_a_site';
  end if;
  update public.sessions set study_id = p_study where id = p_session;
end $$;

-- Bulk form for the study page (all or nothing). Returns how many sessions were changed.
create or replace function public.set_sessions_study(p_sessions uuid[], p_study uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  if coalesce(array_length(p_sessions, 1), 0) > 1000 then raise exception 'too_many_sessions'; end if;
  foreach v_id in array coalesce(p_sessions, '{}'::uuid[]) loop
    perform public.set_session_study(v_id, p_study);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.org_has_multi_site(uuid) from public, anon;
revoke all on function public.create_study(uuid, text, boolean) from public, anon;
revoke all on function public.create_study_invite(uuid, int) from public, anon;
revoke all on function public.revoke_study_invite(uuid) from public, anon;
revoke all on function public.redeem_study_invite(text, uuid) from public, anon;
revoke all on function public.leave_study(uuid, uuid) from public, anon;
revoke all on function public.remove_study_site(uuid, uuid) from public, anon;
revoke all on function public.set_study_share_row_data(uuid, uuid, boolean) from public, anon;
revoke all on function public.set_session_study(uuid, uuid) from public, anon;
revoke all on function public.set_sessions_study(uuid[], uuid) from public, anon;
grant execute on function public.create_study(uuid, text, boolean) to authenticated;
grant execute on function public.create_study_invite(uuid, int) to authenticated;
grant execute on function public.revoke_study_invite(uuid) to authenticated;
grant execute on function public.redeem_study_invite(text, uuid) to authenticated;
grant execute on function public.leave_study(uuid, uuid) to authenticated;
grant execute on function public.remove_study_site(uuid, uuid) to authenticated;
grant execute on function public.set_study_share_row_data(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_session_study(uuid, uuid) to authenticated;
grant execute on function public.set_sessions_study(uuid[], uuid) to authenticated;
