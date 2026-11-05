-- Observability (mandate §9/§10): unexpected server errors of the app's API, visible to the owner in
-- Admin → Обзор. Only the route, method, error class and a truncated message are kept — no request
-- bodies, answers or personal data. Rows older than 30 days are removed by the daily retention job.
create table public.server_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  method text not null,
  path text not null,
  kind text not null,
  message text not null
);
create index server_errors_at on public.server_errors (at desc);
alter table public.server_errors enable row level security;
grant all on table public.server_errors to service_role;
grant usage, select on sequence public.server_errors_id_seq to service_role;
