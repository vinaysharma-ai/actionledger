revoke all on table public.idempotency_records from public;
revoke all on table public.idempotency_records from anon;
revoke all on table public.idempotency_records from authenticated;

grant select on table public.idempotency_records to authenticated;
