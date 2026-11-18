create table public.provider_operations (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	action_id uuid not null,
	provider_name text not null,
	provider_operation_key text not null,
	provider_reference text,
	status text not null
		check (status in ('NOT_STARTED', 'OUTCOME_UNKNOWN', 'SUCCEEDED', 'FAILED')),
	last_checked_at timestamptz,
	safe_result_summary jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint provider_operations_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint provider_operations_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint provider_operations_workspace_id_unique
		unique (workspace_id, id),
	constraint provider_operations_action_provider_unique
		unique (action_id, provider_name),
	constraint provider_operations_provider_key_unique
		unique (provider_name, provider_operation_key)
);

create table public.audit_events (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	workflow_id uuid,
	action_id uuid,
	actor_type text not null
		check (actor_type in ('USER', 'AGENT', 'SYSTEM', 'WORKER')),
	actor_id text,
	event_type text not null,
	entity_type text not null,
	entity_id uuid not null,
	correlation_id uuid,
	metadata jsonb not null default '{}'::jsonb,
	occurred_at timestamptz not null default now(),
	constraint audit_events_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint audit_events_workspace_workflow_fk
		foreign key (workspace_id, workflow_id)
		references public.workflows(workspace_id, id)
		on delete cascade,
	constraint audit_events_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint audit_events_workspace_id_unique
		unique (workspace_id, id)
);

create index audit_events_workspace_occurred_idx
	on public.audit_events (workspace_id, occurred_at desc);
create index audit_events_action_occurred_idx
	on public.audit_events (action_id, occurred_at);
create index audit_events_correlation_occurred_idx
	on public.audit_events (correlation_id, occurred_at);

create trigger provider_operations_set_updated_at
before update on public.provider_operations
for each row execute function public.actionledger_set_updated_at();

create or replace function public.actionledger_check_audit_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
	action_workflow uuid;
begin
	if new.action_id is not null then
		select workflow_id into action_workflow
		from public.actions
		where id = new.action_id and workspace_id = new.workspace_id;

		if action_workflow is null
			or (new.workflow_id is not null and action_workflow is distinct from new.workflow_id)
		then
			raise exception 'audit action and workflow must belong to the same workspace and workflow';
		end if;
	end if;

	if new.workflow_id is not null then
		if not exists (
			select 1
			from public.workflows
			where id = new.workflow_id and workspace_id = new.workspace_id
		) then
			raise exception 'audit workflow must belong to the workspace';
		end if;
	end if;

	return new;
end;
$$;

create trigger audit_events_check_reference
before insert or update on public.audit_events
for each row execute function public.actionledger_check_audit_reference();
