-- Ejecutar en Supabase → SQL Editor, una sola vez.

create table if not exists public.quantis_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.quantis_state enable row level security;

-- Cada usuario solo puede ver/escribir SU propia fila.
create policy "select own state"
  on public.quantis_state for select
  using (auth.uid() = user_id);

create policy "insert own state"
  on public.quantis_state for insert
  with check (auth.uid() = user_id);

create policy "update own state"
  on public.quantis_state for update
  using (auth.uid() = user_id);
