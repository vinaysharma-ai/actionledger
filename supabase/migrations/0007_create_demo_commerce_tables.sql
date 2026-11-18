create table public.demo_orders (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	order_number text not null,
	customer_reference text not null,
	status text not null
		check (status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED')),
	total_amount_minor bigint not null
		check (total_amount_minor >= 0),
	currency text not null
		check (currency = 'USD'),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint demo_orders_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint demo_orders_workspace_id_unique
		unique (workspace_id, id),
	constraint demo_orders_workspace_number_unique
		unique (workspace_id, order_number)
);

create table public.demo_payments (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	order_id uuid not null,
	provider_payment_reference text not null,
	status text not null
		check (status in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
	amount_minor bigint not null
		check (amount_minor >= 0),
	currency text not null
		check (currency = 'USD'),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint demo_payments_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint demo_payments_workspace_order_fk
		foreign key (workspace_id, order_id)
		references public.demo_orders(workspace_id, id)
		on delete cascade,
	constraint demo_payments_workspace_id_unique
		unique (workspace_id, id),
	constraint demo_payments_workspace_reference_unique
		unique (workspace_id, provider_payment_reference)
);

create table public.demo_provider_refunds (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null,
	payment_id uuid not null,
	provider_idempotency_key text not null,
	provider_refund_reference text not null,
	amount_minor bigint not null
		check (amount_minor > 0),
	currency text not null
		check (currency = 'USD'),
	status text not null
		check (status in ('SUCCEEDED', 'FAILED')),
	created_at timestamptz not null default now(),
	constraint demo_provider_refunds_workspace_fk
		foreign key (workspace_id) references public.workspaces(id)
		on delete cascade,
	constraint demo_provider_refunds_workspace_payment_fk
		foreign key (workspace_id, payment_id)
		references public.demo_payments(workspace_id, id)
		on delete cascade,
	constraint demo_provider_refunds_workspace_idempotency_unique
		unique (workspace_id, provider_idempotency_key),
	constraint demo_provider_refunds_workspace_reference_unique
		unique (workspace_id, provider_refund_reference)
);

create or replace function public.actionledger_check_payment_refund_currency()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
	payment_workspace uuid;
	payment_currency text;
begin
	select workspace_id, currency
	into payment_workspace, payment_currency
	from public.demo_payments
	where id = new.payment_id and workspace_id = new.workspace_id;

	if payment_workspace is null or payment_currency is distinct from new.currency
	then
		raise exception 'refund must belong to the payment workspace and use the payment currency';
	end if;

	return new;
end;
$$;

create trigger demo_provider_refunds_check_payment
before insert or update on public.demo_provider_refunds
for each row execute function public.actionledger_check_payment_refund_currency();

create trigger demo_orders_set_updated_at
before update on public.demo_orders
for each row execute function public.actionledger_set_updated_at();

create trigger demo_payments_set_updated_at
before update on public.demo_payments
for each row execute function public.actionledger_set_updated_at();
