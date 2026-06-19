
-- ====== ROLES ======
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "users can read own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- ====== PROFILES ======
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  telegram_chat_id text,
  risk_pct numeric not null default 1.0,
  min_score numeric not null default 0.5,
  alerts_enabled boolean not null default true,
  active_pairs text[] not null default array['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','XAU/USD'],
  active_timeframes text[] not null default array['15min','1h','4h'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "users manage own profile" on public.profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- auto-create profile + default role on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ====== PAIRS ======
create table public.pairs (
  symbol text primary key,
  display_name text not null,
  asset_class text not null default 'forex',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.pairs to authenticated, anon;
grant all on public.pairs to service_role;
alter table public.pairs enable row level security;
create policy "pairs readable" on public.pairs for select to authenticated, anon using (true);

insert into public.pairs (symbol, display_name, asset_class) values
  ('EUR/USD','Euro / US Dollar','forex'),
  ('GBP/USD','British Pound / US Dollar','forex'),
  ('USD/JPY','US Dollar / Japanese Yen','forex'),
  ('USD/CHF','US Dollar / Swiss Franc','forex'),
  ('AUD/USD','Australian Dollar / US Dollar','forex'),
  ('USD/CAD','US Dollar / Canadian Dollar','forex'),
  ('NZD/USD','New Zealand Dollar / US Dollar','forex'),
  ('XAU/USD','Gold / US Dollar','metal');

-- ====== SETUPS ======
create table public.setups (
  id uuid primary key default gen_random_uuid(),
  symbol text not null references public.pairs(symbol),
  timeframe text not null,
  direction text not null check (direction in ('long','short')),
  entry numeric not null,
  sl numeric not null,
  tp1 numeric not null,
  tp2 numeric,
  score numeric not null default 0.5,
  wave_context jsonb not null default '{}'::jsonb, -- { wave: '2'|'4', degree, pivots: [...] }
  ict_context jsonb not null default '{}'::jsonb,  -- { ob, fvg, sweep, bos, choch }
  detected_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending','tp1','tp2','sl','expired','cancelled')),
  closed_at timestamptz,
  rr numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index setups_symbol_tf_idx on public.setups (symbol, timeframe, detected_at desc);
create index setups_status_idx on public.setups (status);
grant select on public.setups to authenticated;
grant all on public.setups to service_role;
alter table public.setups enable row level security;
create policy "setups readable by auth" on public.setups for select to authenticated using (true);
create trigger setups_touch before update on public.setups
  for each row execute function public.touch_updated_at();

-- ====== ALERTS ======
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.setups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('in_app','telegram')),
  status text not null default 'sent' check (status in ('sent','failed','queued')),
  error text,
  sent_at timestamptz not null default now()
);
create index alerts_user_idx on public.alerts (user_id, sent_at desc);
grant select on public.alerts to authenticated;
grant all on public.alerts to service_role;
alter table public.alerts enable row level security;
create policy "users read own alerts" on public.alerts for select to authenticated using (auth.uid() = user_id);

-- ====== TRADE RESULTS ======
create table public.trade_results (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.setups(id) on delete cascade,
  outcome text not null check (outcome in ('tp1','tp2','sl','expired','partial')),
  r_multiple numeric,
  evaluated_at timestamptz not null default now()
);
grant select on public.trade_results to authenticated;
grant all on public.trade_results to service_role;
alter table public.trade_results enable row level security;
create policy "results readable" on public.trade_results for select to authenticated using (true);

-- ====== MODEL VERSIONS ======
create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  model_topology jsonb not null,
  weights_b64 text not null,
  accuracy numeric,
  trained_on int not null default 0,
  created_at timestamptz not null default now(),
  unique (version)
);
grant select on public.model_versions to authenticated;
grant all on public.model_versions to service_role;
alter table public.model_versions enable row level security;
create policy "models readable" on public.model_versions for select to authenticated using (true);

-- ====== REALTIME ======
alter publication supabase_realtime add table public.setups;
alter publication supabase_realtime add table public.alerts;
