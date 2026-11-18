create table public.agent_runs (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	workflow_id uuid not null,
	action_id uuid,
	agent_role text not null
		check (agent_role in ('PLANNER', 'REVIEWER')),
	provider_name text not null,
	model_name text,
	status text not null
		check (status in ('STARTED', 'SUCCEEDED', 'FAILED')),
	input_hash text not null
		check (input_hash ~ '^[0-9a-f]{64}$'),
	output_summary jsonb not null default '{}'::jsonb,
	token_input integer
		check (token_input is null or token_input >= 0),
	token_output integer
		check (token_output is null or token_output >= 0),
	estimated_cost_microunits bigint
		check (estimated_cost_microunits is null or estimated_cost_microunits >= 0),
	error_code text,
	started_at timestamptz not null default now(),
	finished_at timestamptz,
	constraint agent_runs_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint agent_runs_workspace_workflow_fk
		foreign key (workspace_id, workflow_id)
		references public.workflows(workspace_id, id)
		on delete cascade,
	constraint agent_runs_workspace_action_fk
		foreign key (workspace_id, action_id)
		references public.actions(workspace_id, id)
		on delete cascade,
	constraint agent_runs_workspace_id_unique
		unique (workspace_id, id)
);

create index agent_runs_workflow_started_idx
	on public.agent_runs (workflow_id, started_at);
create index agent_runs_action_started_idx
	on public.agent_runs (action_id, started_at)
	where action_id is not null;

create or replace function public.actionledger_check_agent_run()
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

		if action_workflow is null or action_workflow is distinct from new.workflow_id
		then
			raise exception 'agent run action and workflow must belong together';
		end if;
	end if;

	return new;
end;
$$;

create trigger agent_runs_check_action
before insert or update on public.agent_runs
for each row execute function public.actionledger_check_agent_run();
