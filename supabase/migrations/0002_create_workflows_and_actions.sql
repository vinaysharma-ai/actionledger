create table public.workflows (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	workflow_type text not null
		check (workflow_type = 'customer_refund'),
	status text not null
		check (status in (
			'CREATED', 'RUNNING', 'WAITING_APPROVAL',
			'PARTIALLY_COMPLETED', 'SUCCEEDED', 'FAILED',
			'NEEDS_ATTENTION', 'CANCELLED'
		)),
	title text not null
		check (char_length(title) between 1 and 120),
	input_summary jsonb not null default '{}'::jsonb,
	requested_by_type text not null
		check (requested_by_type in ('user', 'agent', 'system')),
	requested_by_id text,
	correlation_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	completed_at timestamptz,
	constraint workflows_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint workflows_workspace_id_unique
		unique (workspace_id, id),
	constraint workflows_workspace_correlation_key
		unique (workspace_id, correlation_id)
);

create index workflows_workspace_created_idx
	on public.workflows (workspace_id, created_at desc);
create index workflows_workspace_status_created_idx
	on public.workflows (workspace_id, status, created_at desc);

create table public.actions (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	workflow_id uuid not null,
	action_type text not null
		check (action_type in (
			'refund_payment',
			'update_order_status',
			'send_customer_notification'
		)),
	target_type text not null
		check (
			(action_type = 'refund_payment' and target_type = 'payment')
			or (action_type in ('update_order_status', 'send_customer_notification') and target_type = 'order')
		),
	target_id text not null
		check (char_length(target_id) >= 1),
	status text not null
		check (status in (
			'AWAITING_APPROVAL', 'READY', 'RUNNING', 'RETRY_WAIT',
			'OUTCOME_UNKNOWN', 'RECONCILING', 'SUCCEEDED',
			'FAILED', 'DENIED', 'CANCELLED'
		)),
	parameters jsonb not null,
	parameters_hash text not null
		check (parameters_hash ~ '^[0-9a-f]{64}$'),
	action_version integer not null default 1
		check (action_version >= 1),
	idempotency_key text not null,
	request_fingerprint text not null
		check (request_fingerprint ~ '^[0-9a-f]{64}$'),
	requested_by_type text not null
		check (requested_by_type in ('user', 'agent', 'system')),
	requested_by_id text,
	requires_approval boolean not null,
	policy_status text not null
		check (policy_status in ('ALLOW', 'REQUIRE_APPROVAL', 'DENY')),
	policy_version text not null,
	attempt_count integer not null default 0
		check (attempt_count >= 0),
	max_attempts integer not null default 3
		check (max_attempts >= 1),
	next_attempt_at timestamptz,
	last_error_code text,
	last_error_summary text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	started_at timestamptz,
	finished_at timestamptz,
	constraint actions_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint actions_workspace_workflow_fk
		foreign key (workspace_id, workflow_id)
		references public.workflows(workspace_id, id)
		on delete cascade,
	constraint actions_workspace_id_unique
		unique (workspace_id, id),
	constraint actions_workspace_id_workflow_unique
		unique (workspace_id, id, workflow_id),
	constraint actions_workspace_idempotency_key_unique
		unique (workspace_id, idempotency_key)
);

create index actions_workspace_workflow_idx
	on public.actions (workspace_id, workflow_id);
create index actions_workspace_status_created_idx
	on public.actions (workspace_id, status, created_at desc);
create index actions_status_next_attempt_idx
	on public.actions (status, next_attempt_at);
create index actions_target_idx
	on public.actions (target_type, target_id);

create table public.action_dependencies (
	workspace_id uuid not null,
	action_id uuid not null,
	depends_on_action_id uuid not null,
	created_at timestamptz not null default now(),
	constraint action_dependencies_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint action_dependencies_depends_on_fk
		foreign key (workspace_id, depends_on_action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint action_dependencies_pkey
		primary key (action_id, depends_on_action_id),
	constraint action_dependencies_no_self_dependency
		check (action_id <> depends_on_action_id)
);

create or replace function public.actionledger_check_action_dependency()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
	action_workspace uuid;
	action_workflow uuid;
	dependency_workspace uuid;
	dependency_workflow uuid;
begin
	select workspace_id, workflow_id
	into action_workspace, action_workflow
	from public.actions
	where id = new.action_id and workspace_id = new.workspace_id;

	select workspace_id, workflow_id
	into dependency_workspace, dependency_workflow
	from public.actions
	where id = new.depends_on_action_id and workspace_id = new.workspace_id;

	if action_workspace is null or dependency_workspace is null
		or action_workspace <> dependency_workspace
		or action_workflow is distinct from dependency_workflow
	then
		raise exception 'action dependency must connect actions in the same workspace and workflow';
	end if;

	return new;
end;
$$;

create trigger action_dependencies_check_tenant
before insert or update on public.action_dependencies
for each row execute function public.actionledger_check_action_dependency();

create trigger workflows_set_updated_at
before update on public.workflows
for each row execute function public.actionledger_set_updated_at();

create trigger actions_set_updated_at
before update on public.actions
for each row execute function public.actionledger_set_updated_at();

create or replace function public.actionledger_protect_action_parameters()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
	if old.status in (
		'READY', 'RUNNING', 'RETRY_WAIT', 'OUTCOME_UNKNOWN',
		'RECONCILING', 'SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED'
	)
	and (
		old.parameters is distinct from new.parameters
		or old.parameters_hash is distinct from new.parameters_hash
		or old.action_version is distinct from new.action_version
	)
	then
		raise exception 'approved or entered action parameters are immutable';
	end if;
	return new;
end;
$$;

create trigger actions_protect_parameters
before update on public.actions
for each row execute function public.actionledger_protect_action_parameters();
