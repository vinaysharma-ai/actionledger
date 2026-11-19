drop policy if exists idempotency_records_select
	on public.idempotency_records;

revoke all on table public.idempotency_records
	from authenticated;
