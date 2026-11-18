create or replace function public.actionledger_current_user_id()
returns uuid
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
	subject text;
begin
	begin
		subject := nullif(current_setting('request.jwt.claim.sub', true), '');
	exception
		when others then
			return null;
	end;

	if subject is null then
		return null;
	end if;

	begin
		return subject::uuid;
	exception
		when others then
			return null;
	end;
end;
$$;

create or replace function public.actionledger_is_workspace_member(
	p_workspace_id uuid,
	p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
	select exists (
		select 1
		from public.workspace_members as members
		where members.workspace_id = p_workspace_id
			and members.user_id = public.actionledger_current_user_id()
			and (p_roles is null or members.role = any(p_roles))
	);
$$;

revoke all on function public.actionledger_current_user_id() from public;
revoke all on function public.actionledger_is_workspace_member(uuid, text[]) from public;
grant execute on function public.actionledger_current_user_id() to authenticated;
grant execute on function public.actionledger_is_workspace_member(uuid, text[]) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workflows enable row level security;
alter table public.actions enable row level security;
alter table public.action_dependencies enable row level security;
alter table public.policy_decisions enable row level security;
alter table public.approvals enable row level security;
alter table public.execution_jobs enable row level security;
alter table public.action_attempts enable row level security;
alter table public.provider_operations enable row level security;
alter table public.audit_events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.demo_orders enable row level security;
alter table public.demo_payments enable row level security;
alter table public.demo_provider_refunds enable row level security;

create policy workspaces_select on public.workspaces
for select to authenticated
using (
	public.actionledger_is_workspace_member(id, null)
);

create policy workspace_members_select on public.workspace_members
for select to authenticated
using (
	user_id = public.actionledger_current_user_id()
	or public.actionledger_is_workspace_member(
		workspace_id,
		array['owner', 'admin']
	)
);

create policy workflows_select on public.workflows
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy actions_select on public.actions
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy action_dependencies_select on public.action_dependencies
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy policy_decisions_select on public.policy_decisions
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy approvals_select on public.approvals
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy execution_jobs_select on public.execution_jobs
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy action_attempts_select on public.action_attempts
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy provider_operations_select on public.provider_operations
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy audit_events_select on public.audit_events
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy agent_runs_select on public.agent_runs
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy demo_orders_select on public.demo_orders
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy demo_payments_select on public.demo_payments
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create policy demo_provider_refunds_select on public.demo_provider_refunds
for select to authenticated
using (public.actionledger_is_workspace_member(workspace_id, null));

create or replace function public.actionledger_protect_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
	raise exception 'append-only record cannot be modified';
end;
$$;

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.actionledger_protect_append_only();

create or replace function public.actionledger_protect_action_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
	if tg_op = 'DELETE' then
		raise exception 'action attempts are append-only';
	end if;

	if old.status <> 'STARTED' then
		raise exception 'completed action attempts are immutable';
	end if;

	if new.status = 'STARTED' then
		raise exception 'started action attempt status must transition to a terminal status';
	end if;

	return new;
end;
$$;

create trigger action_attempts_protect_history
before update or delete on public.action_attempts
for each row execute function public.actionledger_protect_action_attempt();

create or replace function public.actionledger_protect_policy_decision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
	raise exception 'policy decisions are immutable';
end;
$$;

create trigger policy_decisions_append_only
before update or delete on public.policy_decisions
for each row execute function public.actionledger_protect_policy_decision();

create or replace function public.actionledger_protect_approval_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
	if tg_op = 'DELETE' then
		raise exception 'approval records are append-only';
	end if;

	if old.status <> 'PENDING' then
		raise exception 'completed approval decisions are immutable';
	end if;

	if new.status not in ('APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED') then
		raise exception 'a pending approval can only reach a decided or terminal status';
	end if;

	if new.status in ('APPROVED', 'REJECTED') and new.expires_at <= now() then
		raise exception 'approval has expired';
	end if;

	if new.status in ('APPROVED', 'REJECTED')
		and new.decided_by_user_id is null
	then
		raise exception 'approval decision requires an authenticated approver identity';
	end if;

	return new;
end;
$$;

create trigger approvals_append_only
before update or delete on public.approvals
for each row execute function public.actionledger_protect_approval_history();

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'authenticated') then
		execute 'revoke all on all tables in schema public from authenticated';
	end if;
	if exists (select 1 from pg_roles where rolname = 'anon') then
		execute 'revoke all on all tables in schema public from anon';
	end if;
end;
$$;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'authenticated') then
		execute 'grant select on public.workspaces, public.workspace_members, public.workflows, public.actions, public.action_dependencies, public.policy_decisions, public.approvals, public.execution_jobs, public.action_attempts, public.provider_operations, public.audit_events, public.agent_runs, public.demo_orders, public.demo_payments, public.demo_provider_refunds to authenticated';
	end if;
end;
$$;
