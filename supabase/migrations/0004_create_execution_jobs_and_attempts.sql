create table public.execution_jobs (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	workflow_id uuid not null,
	action_id uuid,
	job_type text not null
		check (job_type in ('PLAN_WORKFLOW', 'EXECUTE_ACTION', 'RECONCILE_ACTION')),
	status text not null
		check (status in ('QUEUED', 'LEASED', 'COMPLETED', 'DEAD', 'CANCELLED')),
	available_at timestamptz not null default now(),
	lease_owner text,
	lease_expires_at timestamptz,
	lease_generation bigint not null default 0
		check (lease_generation >= 0),
	claim_count integer not null default 0
		check (claim_count >= 0),
	last_error_code text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	completed_at timestamptz,
	constraint execution_jobs_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint execution_jobs_workspace_workflow_fk
		foreign key (workspace_id, workflow_id)
		references public.workflows(workspace_id, id)
		on delete cascade,
	constraint execution_jobs_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint execution_jobs_workspace_id_unique
		unique (workspace_id, id),
	constraint execution_jobs_workspace_action_id_unique
		unique (workspace_id, action_id, id),
	constraint execution_jobs_action_for_action_jobs
		check (
			(job_type = 'PLAN_WORKFLOW' and action_id is null)
			or
			(job_type in ('EXECUTE_ACTION', 'RECONCILE_ACTION') and action_id is not null)
		),
	constraint execution_jobs_workspace_action_workflow_fk
		foreign key (workspace_id, action_id, workflow_id)
		references public.actions(workspace_id, id, workflow_id)
		on delete cascade
);

create index execution_jobs_available_created_idx
	on public.execution_jobs (available_at, created_at)
	where status = 'QUEUED';
create index execution_jobs_leased_expiry_idx
	on public.execution_jobs (lease_expires_at)
	where status = 'LEASED';
create index execution_jobs_workflow_created_idx
	on public.execution_jobs (workflow_id, created_at desc);
create index execution_jobs_action_type_created_idx
	on public.execution_jobs (action_id, job_type, created_at desc)
	where action_id is not null;

create unique index execution_jobs_one_active_plan
	on public.execution_jobs (workflow_id)
	where job_type = 'PLAN_WORKFLOW' and status in ('QUEUED', 'LEASED');
create unique index execution_jobs_one_active_execute
	on public.execution_jobs (workspace_id, action_id)
	where job_type = 'EXECUTE_ACTION' and status in ('QUEUED', 'LEASED');
create unique index execution_jobs_one_active_reconcile
	on public.execution_jobs (workspace_id, action_id)
	where job_type = 'RECONCILE_ACTION' and status in ('QUEUED', 'LEASED');

create table public.action_attempts (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	action_id uuid not null,
	job_id uuid not null,
	attempt_number integer not null
		check (attempt_number >= 1),
	status text not null
		check (status in ('STARTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN', 'ABANDONED')),
	provider_name text not null,
	provider_operation_key text not null,
	provider_reference text,
	request_hash text not null
		check (request_hash ~ '^[0-9a-f]{64}$'),
	response_summary jsonb not null default '{}'::jsonb,
	error_code text,
	error_summary text,
	started_at timestamptz not null default now(),
	finished_at timestamptz,
	constraint action_attempts_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint action_attempts_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint action_attempts_workspace_job_fk
		foreign key (workspace_id, job_id)
		references public.execution_jobs(workspace_id, id)
		on delete cascade,
	constraint action_attempts_workspace_action_job_fk
		foreign key (workspace_id, action_id, job_id)
		references public.execution_jobs(workspace_id, action_id, id)
		on delete cascade,
	constraint action_attempts_action_attempt_unique
		unique (action_id, attempt_number),
	constraint action_attempts_workspace_id_unique
		unique (workspace_id, id)
);

create index action_attempts_action_attempt_desc_idx
	on public.action_attempts (action_id, attempt_number desc);
create index action_attempts_workspace_started_idx
	on public.action_attempts (workspace_id, started_at desc);

create trigger execution_jobs_set_updated_at
before update on public.execution_jobs
for each row execute function public.actionledger_set_updated_at();

create or replace function public.actionledger_check_action_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
	action_workflow uuid;
	job_workflow uuid;
	job_action_id uuid;
begin
	select workflow_id into action_workflow
	from public.actions
	where id = new.action_id and workspace_id = new.workspace_id;

	select workflow_id, action_id into job_workflow, job_action_id
	from public.execution_jobs
	where id = new.job_id and workspace_id = new.workspace_id;

	if action_workflow is null or job_workflow is null
		or action_workflow is distinct from job_workflow
		or job_action_id is distinct from new.action_id
	then
		raise exception 'action attempt must reference the same action and workflow';
	end if;

	return new;
end;
$$;

create trigger action_attempts_check_tenant
before insert or update on public.action_attempts
for each row execute function public.actionledger_check_action_attempt();
