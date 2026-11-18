create table public.idempotency_records (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	operation_scope text not null,
	idempotency_key text not null
		check (char_length(idempotency_key) between 16 and 128),
	request_fingerprint text not null
		check (request_fingerprint ~ '^[0-9a-f]{64}$'),
	status text not null
		check (status in ('IN_PROGRESS', 'COMPLETED')),
	resource_type text,
	resource_id uuid,
	response_status integer,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	expires_at timestamptz not null,
	constraint idempotency_records_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint idempotency_records_workspace_id_unique
		unique (workspace_id, id),
	constraint idempotency_records_workspace_operation_key_unique
		unique (workspace_id, operation_scope, idempotency_key),
	constraint idempotency_records_expiry_after_created
		check (expires_at > created_at)
);

create index idempotency_records_expires_idx
	on public.idempotency_records (expires_at);

alter table public.idempotency_records enable row level security;

create policy idempotency_records_select on public.idempotency_records
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create trigger idempotency_records_set_updated_at
before update on public.idempotency_records
for each row execute function public.actionledger_set_updated_at();

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'authenticated') then
		execute 'revoke all on table public.idempotency_records from authenticated';
		execute 'grant select on public.idempotency_records to authenticated';
	end if;
end;
$$;
