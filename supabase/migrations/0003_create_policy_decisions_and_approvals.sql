create table public.policy_decisions (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	workflow_id uuid not null,
	action_id uuid not null,
	action_version integer not null check (action_version >= 1),
	parameters_hash text not null
		check (parameters_hash ~ '^[0-9a-f]{64}$'),
	decision text not null
		check (decision in ('ALLOW', 'REQUIRE_APPROVAL', 'DENY')),
	policy_version text not null,
	reason_codes jsonb not null default '[]'::jsonb,
	safe_explanation text not null,
	evaluated_by text not null,
	created_at timestamptz not null default now(),
	constraint policy_decisions_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint policy_decisions_workspace_workflow_fk
		foreign key (workspace_id, workflow_id)
		references public.workflows(workspace_id, id)
		on delete cascade,
	constraint policy_decisions_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint policy_decisions_workspace_id_unique
		unique (workspace_id, id)
);

create index policy_decisions_action_created_idx
	on public.policy_decisions (action_id, created_at desc);
create index policy_decisions_workspace_created_idx
	on public.policy_decisions (workspace_id, created_at desc);

create table public.approvals (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	action_id uuid not null,
	action_version integer not null
		check (action_version >= 1),
	parameters_hash text not null
		check (parameters_hash ~ '^[0-9a-f]{64}$'),
	status text not null
		check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED')),
	requested_at timestamptz not null,
	expires_at timestamptz not null,
	decided_at timestamptz,
	decided_by_user_id uuid,
	decision_reason text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint approvals_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint approvals_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint approvals_workspace_id_unique
		unique (workspace_id, id),
	constraint approvals_expiry_after_request
		check (expires_at > requested_at)
);

create index approvals_workspace_status_expires_idx
	on public.approvals (workspace_id, status, expires_at);
create index approvals_action_created_idx
	on public.approvals (action_id, created_at desc);
create unique index approvals_one_pending_per_action_version
	on public.approvals (workspace_id, action_id, action_version)
	where status = 'PENDING';

create trigger approvals_set_updated_at
before update on public.approvals
for each row execute function public.actionledger_set_updated_at();

create or replace function public.actionledger_check_policy_decision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
	action_workflow uuid;
	action_version integer;
	action_parameters_hash text;
begin
	select workflow_id, action_version, parameters_hash
	into action_workflow, action_version, action_parameters_hash
	from public.actions
	where id = new.action_id and workspace_id = new.workspace_id;

	if action_workflow is null
		or action_workflow is distinct from new.workflow_id
		or action_version is distinct from new.action_version
		or action_parameters_hash is distinct from new.parameters_hash
	then
		raise exception 'policy decision must match the action version and parameters';
	end if;

	return new;
end;
$$;

create trigger policy_decisions_check_action
before insert or update on public.policy_decisions
for each row execute function public.actionledger_check_policy_decision();

create or replace function public.actionledger_check_approval()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
	action_version integer;
	action_parameters_hash text;
begin
	select action_version, parameters_hash
	into action_version, action_parameters_hash
	from public.actions
	where id = new.action_id and workspace_id = new.workspace_id;

	if action_version is null
		or action_version is distinct from new.action_version
		or action_parameters_hash is distinct from new.parameters_hash
	then
		raise exception 'approval must match the action version and parameters';
	end if;

	return new;
end;
$$;

create trigger approvals_check_action
before insert or update on public.approvals
for each row execute function public.actionledger_check_approval();
