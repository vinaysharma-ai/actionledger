# ActionLedger — Implementation Plan

**Version:** 0.1  
**Status:** Proposed delivery sequence  
**Execution approach:** Small, reviewable tasks; tests before broad feature expansion

## 1. Implementation principles

- Build a working vertical slice before broad abstractions.
- Keep the code understandable to a junior engineer learning the stack.
- Use TypeScript strict mode and shared Zod contracts.
- Prefer one modular monolith plus a separate worker over premature microservices.
- Use Supabase PostgreSQL for persistence; do not require a heavy local database stack on a 4 GB laptop.
- Use mock agents and simulated providers before paying for LLM APIs or external integrations.
- Every milestone must have acceptance criteria and automated tests.
- Coding agents receive one narrow task at a time and must read relevant docs first.
- The developer must review and understand generated code before merging it.

## 2. Repository setup

Proposed repository: `actionledger`.

```text
actionledger/
  apps/
    web/
    api/
    worker/
  packages/
    contracts/
    domain/
    database/
    policies/
    execution/
    providers/
    agents/
  docs/
    PRD.md
    SYSTEM-ARCHITECTURE.md
    DATABASE-SCHEMA.md
    API-SPECIFICATION.md
    SECURITY-DESIGN.md
    TESTING-STRATEGY.md
    IMPLEMENTATION-PLAN.md
  supabase/
    migrations/
  .github/
    workflows/
  .env.example
  .gitignore
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
```

Use pnpm workspaces initially. Do not add Turborepo or a task orchestration layer until build complexity warrants it.

## 3. Milestones

### M0 — Documentation baseline and repository

Tasks:

1. Create public GitHub repository `actionledger`.
2. Add all project documents under `docs/`.
3. Add root README with project summary, architecture link, status and demo warning.
4. Add `.gitignore` and `.env.example` with variable names only.
5. Initialize pnpm workspace and TypeScript base configuration.
6. Add formatting, lint and type-check scripts.

Acceptance:

- Clean clone can install dependencies using the lockfile.
- No secrets are committed.
- Docs in repository match the approved baseline.
- `pnpm lint`, `pnpm typecheck` and formatting check run successfully on the initial scaffold.

### M1 — Contracts and domain foundation

Tasks:

1. Define workflow, action, approval, policy and provider outcome types.
2. Implement Zod schemas for workflow requests and action proposal discriminated unions.
3. Implement canonical JSON normalization and SHA-256 request/parameter fingerprints.
4. Implement allowed action types and parameter validation.
5. Implement pure action and workflow state transition functions.
6. Add unit tests for validation, hashes and legal transitions.

Acceptance:

- Unknown action types are rejected.
- Invalid amount/currency/target fields are rejected.
- Canonical equivalent input yields the same fingerprint.
- Materially changed input yields a different fingerprint.
- Illegal state transitions are rejected.

### M2 — Database migrations and repository layer

Tasks:

1. Create ordered Supabase SQL migrations matching `DATABASE-SCHEMA.md`.
2. Include tenant-consistency composite keys/foreign keys.
3. Add RLS policies and least-privilege role grants as documented.
4. Create typed database repository functions.
5. Create seed script for synthetic workspace/order/payment.
6. Add migration and repository integration tests.

Acceptance:

- Migrations apply to a clean PostgreSQL database.
- Seed script can run more than once without duplicate fixtures.
- Cross-workspace relationships are rejected.
- Ordinary user role cannot modify append-only audit history.
- Browser cannot access privileged secrets.

Laptop note: do not require local Supabase Docker services on the 4 GB machine. Use a dedicated Supabase development project for manual development initially; run disposable PostgreSQL integration tests in CI. Keep production and dev projects separate if a public demo later requires it.

### M3 — Fastify API foundation

Tasks:

1. Configure Fastify application and route registration.
2. Implement Supabase JWT verification.
3. Implement workspace membership/role authorization.
4. Implement standard error envelope and request IDs.
5. Implement `POST /workspaces/:workspaceId/workflows` with HTTP idempotency.
6. Atomically create workflow, `PLAN_WORKFLOW` job and audit event.
7. Implement workflow/action/event read endpoints and cursor pagination.
8. Add API tests.

Acceptance:

- Workflow creation returns `202 Accepted`.
- Exact HTTP replay returns the original workflow.
- Same key with changed body returns 409.
- User cannot access another workspace's records.
- Long-running agent/provider operations do not run inside the HTTP request.

### M4 — Deterministic policy and approval

Tasks:

1. Implement refund eligibility policy for synthetic orders.
2. Implement amount threshold and role checks.
3. Persist policy decision and reason codes.
4. Create pending approval for actions above threshold.
5. Implement approve/reject endpoints with row locking.
6. Bind decision to action version and parameters hash.
7. Atomically transition approved action to READY and create execution job.
8. Add expiry, replay and mismatch tests.

Acceptance:

- An approval-pending action cannot execute.
- Viewer cannot approve.
- Expired or mismatched approval is rejected.
- Approval and job creation are atomic.

### M5 — Execution engine and simulated provider

Tasks:

1. Define provider interfaces and normalized outcomes.
2. Implement simulated order provider.
3. Implement simulated payment provider with its own provider-side idempotency table.
4. Implement action executor for `refund_payment`.
5. Implement action state transitions and append-only attempts.
6. Implement safe provider result persistence and audit events.
7. Add provider contract and integration tests.

Acceptance:

- A permitted refund changes simulated provider state once.
- Repeated provider call with same key does not create another refund.
- Same provider key with changed payload is rejected.
- Successful action has provider evidence.

### M6 — Worker, durable jobs and recovery

Tasks:

1. Implement PostgreSQL job claim using `FOR UPDATE SKIP LOCKED`.
2. Add worker identity, lease expiration and lease generation.
3. Implement heartbeat and stale-worker fencing.
4. Implement `PLAN_WORKFLOW`, `EXECUTE_ACTION` and `RECONCILE_ACTION` handlers.
5. Implement bounded retry scheduling and jitter for safe errors.
6. Implement `OUTCOME_UNKNOWN` transition and reconciliation lookup.
7. Implement startup recovery scan for expired leases.
8. Add worker crash and concurrent worker tests.

Acceptance:

- Two workers cannot own the same valid lease.
- A stale worker cannot commit after a newer lease generation exists.
- Crash before provider call can be safely reclaimed.
- Crash after provider commit is reconciled and does not create another refund.
- Ambiguous status remains `NEEDS_ATTENTION` rather than retrying blindly.

### M7 — Agent orchestration

Tasks:

1. Define `LLMProvider` interface.
2. Implement `MockLLMProvider` with fixed Planner/Reviewer fixtures.
3. Implement Planner schema and agent run recording.
4. Implement Reviewer schema and advisory findings.
5. Validate all generated proposals and pass them to deterministic policies.
6. Add one real LLM provider adapter only after mock workflow is stable.
7. Add prompt-injection and malformed-output tests.

Acceptance:

- Mock workflow is deterministic and fully testable.
- LLM output cannot authorize itself or set action status.
- Unknown/unsafe actions are rejected.
- Provider failure does not create executable actions.
- API credentials remain server-side.

### M8 — Dashboard

Tasks:

1. Set up Next.js app and Supabase Auth.
2. Add workspace-aware route protection.
3. Add workflow list/detail pages.
4. Add action status and event timeline.
5. Add approval queue with exact action summary.
6. Add approve/reject UI that calls Fastify API.
7. Add failure scenario status/diagnostics for demo mode.
8. Add Playwright critical path tests.

Acceptance:

- Dashboard displays persisted API data.
- Approval actions are enforced by server API, not UI state.
- Viewer cannot see approval controls that grant permission; API still blocks unauthorized requests.
- Timeline distinguishes agent proposal, policy decision, human approval, provider result and verified outcome.

### M9 — MCP and external integration demonstration

Tasks:

1. Expose a small, read-limited MCP toolset for listing action status and requesting a controlled proposal/execution flow.
2. Use registered action names and Zod contracts.
3. Do not expose credentials or arbitrary provider operations.
4. Add MCP contract and authorization tests.
5. Document connecting a compatible client using synthetic data.

Acceptance:

- External client can request only registered safe operations.
- Tool calls pass through the same policy and execution flow.
- MCP cannot bypass approval, idempotency or workspace authorization.

### M10 — CI, deployment and public showcase

Tasks:

1. Add GitHub Actions for lint, typecheck, unit, integration and build checks.
2. Deploy Next.js dashboard to Vercel.
3. Deploy API and worker to an independently running Node.js host selected after free-tier review.
4. Configure separate dev/demo secrets.
5. Verify Supabase pause and wake behaviour for free project.
6. Add health checks, structured logs and safe error reporting.
7. Create reproducible demo seed and reset procedure.
8. Record a short technical walkthrough.
9. Publish architecture, API, test report and limitations.

Acceptance:

- Public demo works with synthetic data.
- Worker is not tied to Vercel request lifecycle or the developer's laptop.
- CI blocks merges on critical test failure.
- Demo never processes real payments or real customer data.
- Limitations and measured test results are documented.

## 4. Suggested first vertical slice

The first end-to-end engineering slice should be deliberately small:

1. Seed one synthetic order `ORD-1042` and a USD 500.00 payment.
2. Create a refund workflow through Fastify.
3. Persist workflow and planning job.
4. Use MockLLMProvider to create one `refund_payment` proposal.
5. Apply a deterministic policy requiring approval above USD 100.00.
6. Approve the refund as an authorized operator.
7. Worker executes refund in simulated provider.
8. Read verified result through API.

Do not build the complete dashboard before this vertical slice works through API/tests.

## 5. First coding-agent task template

Use one task at a time. Example for the initial scaffold:

```text
Read these files first:
- docs/PRD.md
- docs/SYSTEM-ARCHITECTURE.md
- docs/IMPLEMENTATION-PLAN.md

Task: create only the initial pnpm workspace and TypeScript configuration.

Constraints:
- Do not implement business features.
- Do not add a database, LLM provider or deployment configuration yet.
- Use the package structure in SYSTEM-ARCHITECTURE.md.
- Add only the minimum scripts needed for lint, typecheck and formatting.
- Do not invent environment secrets.

Before finishing:
- Run the available checks.
- Report exactly which files changed.
- Report commands run and their results.
- List unresolved issues.
- Stop after this task; do not continue to the next milestone.
```

For later tasks, keep the same narrow scope, file boundaries, acceptance criteria and stop condition. Require the agent to report commands and test results rather than dumping entire files.

## 6. Work tracking

Use GitHub Issues or a project board with:

- Milestone.
- Task description.
- Relevant document sections.
- Acceptance criteria.
- Test evidence.
- Status: Todo / In Progress / Review / Done.

Every implementation task should link to the relevant documentation and tests. Avoid a large unreviewable coding-agent task.

## 7. Release gates

Do not move to the next major milestone until:

- Current milestone acceptance criteria pass.
- Changes are reviewed by the developer.
- Tests are committed.
- Documentation is updated if behaviour/contracts changed.
- No secrets or generated data are accidentally committed.

Do not claim a feature is complete solely because the coding agent reports it complete.

## 8. Definition of project completion

ActionLedger's portfolio release is ready when the complete refund workflow is reproducible, the critical failure and security scenarios pass, the dashboard explains the event history, the repository contains clean documentation and CI evidence, and the author can explain and modify the important code paths independently.
