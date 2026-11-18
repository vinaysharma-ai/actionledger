create extension if not exists pgcrypto;

create table public.workspaces (
	id uuid primary key default gen_random_uuid(),
	name text not null
		check (char_length(name) between 1 and 120),
	slug text not null
		check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	created_by uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint workspaces_slug_key unique (slug),
	constraint workspaces_id_unique unique (id)
);

create index workspaces_created_by_idx on public.workspaces (created_by);

create table public.workspace_members (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	user_id uuid not null,
	role text not null
		check (role in ('owner', 'admin', 'operator', 'viewer')),
	created_at timestamptz not null default now(),
	constraint workspace_members_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint workspace_members_workspace_user_key
		unique (workspace_id, user_id),
	constraint workspace_members_workspace_id_unique
		unique (workspace_id, id)
);

create or replace function public.actionledger_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.actionledger_set_updated_at();
