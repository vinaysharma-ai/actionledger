# ActionLedger — Testing Strategy

**Version:** 0.1  
**Status:** MVP test plan  
**Primary tools:** Vitest, Playwright, PostgreSQL integration tests, GitHub Actions

## 1. Testing objectives

Testing is a core feature of ActionLedger. The project must prove that it does not blindly repeat consequential operations when workers crash, providers time out or workflows partially complete.

The test strategy focuses on correctness, security boundaries, persistence, concurrency and recoverability—not just line coverage.

## 2. Test layers

### 2.1 Static checks

Run on every pull request:

- TypeScript compiler in strict mode.
- ESLint.
- Formatting check.
- Zod contract/type checks through compilation and tests.
- Dependency lockfile consistency.

### 2.2 Unit tests — Vitest

Test isolated domain logic without network or database dependencies.

Required areas:

- Action state transition validator.
- Workflow state aggregation.
- Canonical JSON normalization and parameter hashing.
- Money validation and currency handling.
- Policy thresholds and permission checks.
- Approval validity calculation.
- Retry classification and backoff calculation.
- Provider outcome classification.
- Agent output schema validation.
- Audit metadata redaction.

Use fixed clocks and deterministic IDs where practical. Never call a real LLM in ordinary unit tests.

### 2.3 Database integration tests

Run against a disposable PostgreSQL database in CI. Local developers with limited hardware may run unit tests locally and use a dedicated Supabase development project for selected manual/integration checks; do not require local Ollama or a full Docker stack to contribute.

Test:

- Migrations apply to a clean database.
- Constraints reject invalid states and duplicate keys.
- Workspace composite foreign keys prevent cross-tenant relationships.
- Workflow + `PLAN_WORKFLOW` job creation is atomic.
- Approval + READY transition + execution job creation is atomic.
- `FOR UPDATE SKIP LOCKED` prevents two workers claiming the same queued job.
- Lease generation prevents stale workers from committing results.
- Audit and terminal attempt immutability permissions work.
- RLS and application authorization prevent workspace data leakage.

### 2.4 Provider contract tests

Every provider adapter must implement the same contract suite.

For the simulated payment provider verify:

- Same idempotency key and same payload returns the original refund.
- Same key and different payload returns conflict.
- Refund amount cannot exceed refundable amount.
- Currency mismatch is rejected.
- Refund operation reference is stable and queryable.
- A committed refund can be found after a simulated response loss.
- Provider state is distinct from ActionLedger action state.

### 2.5 Worker and failure-injection tests

Use deterministic fault switches in the simulator; do not rely on random network flakiness.

Scenarios:

1. Provider fails before receiving a request.
2. Provider receives request but does not commit.
3. Provider commits refund then transport response is lost.
4. Provider returns a retryable rate-limit response.
5. Provider returns a definitive validation failure.
6. Worker crashes after claiming job but before provider call.
7. Worker crashes after provider commit but before saving result.
8. Worker lease expires while a slow request is in flight.
9. Old worker returns after a new worker has reclaimed work.
10. Reconciliation provider lookup is temporarily unavailable.
11. Reconciliation confirms success.
12. Reconciliation confirms no operation occurred and a retry is safe.
13. Provider state remains ambiguous and action moves to manual attention.

### 2.6 API tests

Test each endpoint's:

- Valid request/response schema.
- Missing/invalid token behaviour.
- Workspace membership checks.
- Role checks.
- Input validation and size limits.
- Idempotency replay.
- Same key/different payload conflict.
- Invalid state conflict.
- Safe error envelope and request ID.
- Pagination ordering and cursor behaviour.

### 2.7 End-to-end browser tests — Playwright

A small critical-path suite:

- Sign in to seeded demo workspace.
- Create refund workflow.
- Observe planning status.
- View generated actions.
- Approve a pending refund.
- Watch execution complete.
- Inspect timeline and provider evidence.
- Trigger a preconfigured failure scenario and see recovery status.

Keep E2E suite small and deterministic. Run full browser tests in CI; on the developer's 4 GB laptop, run focused browser tests when necessary rather than leaving multiple dev servers and browsers running simultaneously.

## 3. Critical acceptance test matrix

| ID | Scenario | Expected result |
|---|---|---|
| T-01 | Create refund workflow | Workflow and planning job persist atomically |
| T-02 | Replay same workflow request key and body | Original workflow returned; no duplicate workflow |
| T-03 | Reuse request key with changed body | `409 IDEMPOTENCY_KEY_REUSED` |
| T-04 | Planner returns unknown action type | Proposal rejected; no execution job created |
| T-05 | Planner proposes amount greater than eligible amount | Policy denies or escalates; no payment call |
| T-06 | Refund exceeds approval threshold | Action becomes `AWAITING_APPROVAL` |
| T-07 | Attempt execution without approval | No provider call; action remains gated |
| T-08 | Approve valid pending action | Approval and execution job persist atomically |
| T-09 | Approve expired action | Conflict; no execution job |
| T-10 | Change action parameters after approval | Old approval rejected |
| T-11 | Two requests use same action key concurrently | One logical action |
| T-12 | Two workers claim same job concurrently | Only one valid lease owner |
| T-13 | Worker crashes before provider call | Job safely reclaimed; no external side effect duplicated |
| T-14 | Provider commits then response is lost | Action becomes unknown; reconcile finds one refund |
| T-15 | Reconciliation confirms refund | Action becomes `SUCCEEDED`; refund count remains one |
| T-16 | Provider definitively rejects refund | Action becomes `FAILED` or `DENIED` according to normalized result; no blind retry |
| T-17 | Retryable transient failure | Bounded retry scheduled with backoff |
| T-18 | Reconciliation cannot determine outcome | `NEEDS_ATTENTION`; no automatic repeat |
| T-19 | CRM/order update fails after refund succeeds | Workflow partial; refund is not repeated on recovery |
| T-20 | Worker restarts with queued/leased jobs | Work resumes from persisted state safely |
| T-21 | Viewer attempts approval | `403 FORBIDDEN` |
| T-22 | User accesses another workspace resource | `404` or equivalent non-enumerating denial; no data leak |
| T-23 | Stale worker attempts to persist result | Write rejected due to lease generation mismatch |
| T-24 | Audit event metadata contains secret-like value | Secret redacted or rejected before persistence |
| T-25 | LLM provider unavailable | Workflow records planning failure safely; no actions execute |

## 4. Invariants to assert

Tests should continuously assert:

- At most one simulated provider refund exists per provider idempotency key.
- A denied or approval-pending action never calls the provider.
- A `SUCCEEDED` action has verified provider evidence.
- `OUTCOME_UNKNOWN` is never converted to a safe retry without reconciliation evidence or provider idempotency guarantees.
- A stale lease generation cannot mutate action state.
- The count of successful refunds never exceeds the permitted refundable amount.
- Successful child actions are not executed again during workflow recovery.
- Workspace records never cross tenant boundaries.
- The audit event sequence remains available after restarts.

## 5. Test data and fixtures

Use seeded synthetic records:

- Workspace: `demo-workspace`.
- Order: `ORD-1042`.
- Customer: `CUS-1001`.
- Payment: USD 500.00 (`50000` minor units).
- Default policy threshold: USD 100.00 (`10000` minor units), requiring approval above threshold.

Fixtures must be idempotent and resettable. Do not use real customer, payment or personal data.

## 6. Test doubles and fault injection

The simulated provider must expose deterministic test controls, unavailable to public production/demo users unless explicitly running a controlled demo mode:

- `fail_before_commit`.
- `commit_then_drop_response`.
- `rate_limit_once`.
- `reject_permanently`.
- `delay_response`.
- `lookup_unavailable`.

Test controls must not be accepted as arbitrary user-supplied provider parameters in production builds. They are test fixtures or protected demo-only scenarios.

The Mock LLM provider returns fixed, versioned fixtures for Planner and Reviewer outputs. Real model responses are tested separately as contract/compatibility checks, not as deterministic correctness tests.

## 7. CI pipeline

On every pull request:

1. Install dependencies using the lockfile.
2. Run formatting check.
3. Run ESLint.
4. Run TypeScript type check.
5. Run unit tests.
6. Provision PostgreSQL service and apply migrations.
7. Run database/provider/worker integration tests.
8. Run API tests.
9. Build web, API and worker packages.
10. Run a small Playwright smoke suite where CI resources permit.

A merge is blocked by failing required checks. Keep secrets out of forked/untrusted pull-request jobs. Do not expose production Supabase credentials to normal CI tests.

## 8. Performance and load checks

Performance tests are a later milestone. First establish correctness. When added, measure:

- API request latency for workflow creation and reads.
- Job claim throughput with multiple workers.
- Database lock contention.
- Provider timeout/reconciliation duration.
- Audit query behaviour with realistic event counts.

Publish only measured results with environment, dataset and test method. Do not claim production capacity based on a laptop benchmark.

## 9. Definition of test readiness

The MVP is not ready for public demonstration until all critical tests T-01 through T-25 pass or have a documented, explicitly accepted limitation. The lost-response reconciliation test and approval bypass tests are release blockers.
