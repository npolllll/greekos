-- Self-registration of learners, controlled by the owner.
-- The owner chooses the mode (closed / by registration code / open) and the number of learner seats.
-- A visitor's request is checked on the server (mode, code, free seats, rate limit); the account is
-- created through the same e-mail link flow as an owner's invitation, so the address is verified
-- before any password exists. Direct sign-ups at the auth service stay disabled (config.toml).

create table public.platform_settings (
  id boolean primary key default true check (id),
  registration_mode text not null default 'closed' check (registration_mode in ('closed', 'code', 'open')),
  registration_code_hash text,
  max_learners integer not null default 5 check (max_learners between 1 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- Default: open self-registration limited to 5 learner seats (the planned group size); the owner can
-- switch to «by code» or «closed» in Admin → Ученики.
insert into public.platform_settings (id, registration_mode, max_learners) values (true, 'open', 5) on conflict do nothing;
alter table public.platform_settings enable row level security;
-- Read and written only by the server (service role); no client policies.

alter table public.invitations add column source text not null default 'owner' check (source in ('owner', 'self'));
alter table public.invitations alter column display_name set default '';

alter table public.profiles add column signup_source text not null default 'invite' check (signup_source in ('invite', 'self', 'owner'));

create table public.registration_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  email_hash text not null,
  outcome text not null check (outcome in ('sent', 'exists', 'closed', 'bad_code', 'no_seats', 'rate_limited', 'failed')),
  created_at timestamptz not null default now()
);
create index registration_attempts_ip_time on public.registration_attempts (ip_hash, created_at desc);
alter table public.registration_attempts enable row level security;

grant all on table public.platform_settings to service_role;
grant all on table public.registration_attempts to service_role;
