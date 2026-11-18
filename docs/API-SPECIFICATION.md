# ActionLedger — API Specification

**Version:** 0.1  
**Status:** Proposed MVP contract  
**Base path:** `/v1`  
**Transport:** HTTPS + JSON  
**Authentication:** Supabase Auth access token (Bearer JWT)

## 1. API principles

1. The API exposes business resources, not raw database tables.
2. Every workspace-scoped request checks authenticated membership and role on the server.
3. Long-running planning/execution is asynchronous. Commands return a resource ID and status; clients poll or refresh read endpoints.
4. All request bodies are validated at runtime using shared Zod contracts.
5. Money uses integer minor units and ISO currency codes.
6. LLM output is untrusted until validated against registered action schemas.
7. Worker claim/heartbeat/result operations are internal and are not public user endpoints.
8. API request idempotency and action/provider idempotency are separate mechanisms.

## 2. Common request conventions

### Authentication

```http
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

The API validates the token signature, issuer, audience and expiration using the configured Supabase project/auth validation mechanism. It then checks membership in the requested workspace. Never accept a `user_id`, `role` or `is_admin` value from the request body as proof of identity.

### Workspace scope

All application endpoints use `/workspaces/{workspaceId}/...`. The workspace ID is a locator, not authorization. The server must verify membership and required role on every request and scope all DB reads/writes to that workspace.

### Idempotency

Commands that create a workflow or trigger a consequential operation require:

```http
Idempotency-Key: <opaque-random-key>
```

Requirements:

- 16–128 printable ASCII characters; reject whitespace-only values.
- Scope key by workspace and operation route.
- Store a SHA-256 fingerprint of canonical validated input.
- Same key + same fingerprint returns the original resource/result.
- Same key + different fingerprint returns `409 IDEMPOTENCY_KEY_REUSED`.
- Initial record retention target is 7 days; never expire action/provider idempotency while an operation remains unresolved.

### Pagination

List endpoints accept `limit` (default 25, maximum 100) and opaque `cursor`. Return `data`, `nextCursor` and `hasMore`. Use stable ordering by `(created_at DESC, id DESC)`.

### Timestamps and money

- ISO 8601 UTC timestamps.
- Amounts are integer minor units: USD 500.00 is `amountMinor: 50000`, `currency: "USD"`.

## 3. Common response envelope

Successful single-resource responses:

```json
{
  "data": { "id": "uuid", "status": "..." },
  "meta": { "requestId": "uuid" }
}
```

List responses:

```json
{
  "data": [],
  "meta": {
    "requestId": "uuid",
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error responses:

```json
{
  "error": {
    "code": "APPROVAL_EXPIRED",
    "message": "This approval has expired.",
    "details": [],
    "retryable": false
  },
  "meta": { "requestId": "uuid" }
}
```

Never return stack traces, database connection strings, tokens, raw provider secrets or unredacted provider payloads.

## 4. Resource contracts

### 4.1 Workflow

```ts
type WorkflowStatus =
  | 'CREATED' | 'RUNNING' | 'WAITING_APPROVAL'
  | 'PARTIALLY_COMPLETED' | 'SUCCEEDED' | 'FAILED'
  | 'NEEDS_ATTENTION' | 'CANCELLED';

interface WorkflowSummary {
  id: string;
  workflowType: 'customer_refund';
  title: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

### 4.2 Action proposal (internal domain contract)

The public caller submits a customer request, not an arbitrary executable action. The Planner returns proposals that are validated by the server.

```ts
type ActionProposal =
  | {
      actionType: 'refund_payment';
      targetType: 'payment';
      targetId: string;
      parameters: {
        orderNumber: string;
        amountMinor: number;
        currency: 'USD';
        reasonCode: 'DAMAGED_ITEM' | 'OTHER_APPROVED_REASON';
      };
    }
  | {
      actionType: 'update_order_status';
      targetType: 'order';
      targetId: string;
      parameters: {
        orderNumber: string;
        newStatus: 'PARTIALLY_REFUNDED' | 'REFUNDED';
      };
    }
  | {
      actionType: 'send_customer_notification';
      targetType: 'order';
      targetId: string;
      parameters: {
        orderNumber: string;
        templateId: 'REFUND_CONFIRMED';
      };
    };
```

The actual schemas must use Zod discriminated unions and validate positive integer amounts, allowed currency, string lengths, known resource references and safe enumerated values. The API must never accept a provider name, URL, credential or arbitrary function name from an agent as an executable instruction.

### 4.3 Action status

```ts
type ActionStatus =
  | 'AWAITING_APPROVAL' | 'READY' | 'RUNNING' | 'RETRY_WAIT'
  | 'OUTCOME_UNKNOWN' | 'RECONCILING' | 'SUCCEEDED'
  | 'FAILED' | 'DENIED' | 'CANCELLED';
```

Action status is server-controlled. Clients cannot PATCH the status directly.

## 5. Endpoint catalogue

All endpoints below, except health endpoints, require authentication and workspace membership.

### 5.1 Health

`GET /health/live`

- Purpose: process liveness only.
- Response: `200 { "status": "ok" }`.
- No dependency details or secrets.

`GET /health/ready`

- Purpose: readiness check for required API dependencies.
- Response `200` when ready; `503` when an essential dependency is unavailable.
- Do not expose DB hostnames, credentials or raw errors.

### 5.2 Create workflow

`POST /workspaces/{workspaceId}/workflows`

Required role: `owner`, `admin` or `operator`.

Required header: `Idempotency-Key`.

Request:

```json
{
  "workflowType": "customer_refund",
  "title": "Damaged item refund — ORD-1042",
  "request": {
    "orderNumber": "ORD-1042",
    "customerMessage": "My order arrived damaged. I would like a refund."
  }
}
```

Validation:

- `workflowType` must be `customer_refund` in MVP.
- `orderNumber` must match the allowed identifier format and maximum length.
- `customerMessage` has a strict length limit and is treated as untrusted data.
- Do not accept a caller-supplied policy decision, approval status, action execution status or provider credential.

Transaction:

1. Compute canonical request fingerprint.
2. Reserve/check the `idempotency_records` row scoped by workspace and operation path.
3. Insert workflow with status `CREATED`.
4. Insert `PLAN_WORKFLOW` job linked to the workflow (no action ID yet).
5. Insert `WORKFLOW_CREATED` audit event.
6. Commit.

Response: `202 Accepted`.

```json
{
  "data": {
    "workflowId": "uuid",
    "status": "CREATED",
    "planning": "QUEUED"
  },
  "meta": { "requestId": "uuid" }
}
```

An exact replay returns the existing workflow resource. A changed body with the same idempotency key returns `409`.

### 5.3 List workflows

`GET /workspaces/{workspaceId}/workflows?status=RUNNING&limit=25&cursor=...`

Required role: any workspace member.

Optional filters: valid workflow status, date range. Return summaries only; do not include sensitive raw input by default.

### 5.4 Get workflow

`GET /workspaces/{workspaceId}/workflows/{workflowId}`

Returns workflow summary, safe request summary, current status, action summaries and timestamps. Verify the workflow belongs to the path workspace.

### 5.5 Get action

`GET /workspaces/{workspaceId}/actions/{actionId}`

Returns action type, target, safe normalized parameters, status, policy summary, approval requirement, attempt count and safe last error. Do not expose internal credentials or unrestricted provider payloads.

### 5.6 Get workflow timeline

`GET /workspaces/{workspaceId}/workflows/{workflowId}/events?limit=50&cursor=...`

Returns chronologically ordered audit events with actor type, event type, time and sanitized metadata. Verify workspace ownership before querying events.

### 5.7 List approvals

`GET /workspaces/{workspaceId}/approvals?status=PENDING&limit=25&cursor=...`

Required role: `operator`, `admin` or `owner` to view the approval queue. A viewer may read only approval summaries if workspace policy allows; they cannot decide them.

Return action ID, type, target, amount, reason codes, parameter hash prefix, requested time and expiration. Never expose secrets or full sensitive customer content.

### 5.8 Approve action

`POST /workspaces/{workspaceId}/actions/{actionId}/approve`

Required role: `operator`, `admin` or `owner`, plus any policy-specific approval permission.

Required header: `Idempotency-Key`.

Request:

```json
{ "approvalId": "uuid", "reason": "Reviewed the damaged-item evidence." }
```

The server transaction must:

1. Lock the approval and action rows.
2. Verify membership and role from authenticated identity.
3. Verify approval is still `PENDING` and not expired.
4. Verify action version and parameter hash match.
5. Verify current policy still permits approval.
6. Mark approval `APPROVED` with approver and decision time.
7. Transition action to `READY`.
8. Insert exactly one `EXECUTE_ACTION` job.
9. Append an audit event.
10. Commit.

Response: `200` with approval and action status. If expired, changed or already decided, return an appropriate conflict (`409`) rather than silently accepting.

### 5.9 Reject action

`POST /workspaces/{workspaceId}/actions/{actionId}/reject`

Same role and approval checks as approve.

Request:

```json
{ "approvalId": "uuid", "reason": "Refund evidence is insufficient." }
```

Transaction marks approval `REJECTED`, action `DENIED`, appends audit event and updates workflow summary. No execution job is created.

### 5.10 Request reconciliation

`POST /workspaces/{workspaceId}/actions/{actionId}/reconcile`

Required role: `operator`, `admin` or `owner`.

Required header: `Idempotency-Key`.

Allowed only when action is `OUTCOME_UNKNOWN` or in an allowed reconciliation state. Creates or reuses a `RECONCILE_ACTION` job. Does not directly retry the provider operation.

Response: `202 Accepted` with action ID and reconciliation status.

### 5.11 List audit events

`GET /workspaces/{workspaceId}/audit-events?workflowId=...&limit=50&cursor=...`

Required role: workspace member; sensitive metadata may be restricted to `operator` and above. Audit events are read-only through the public API.

## 6. Internal worker contract (not a public HTTP API)

The worker uses trusted server-side database/domain services. Do not expose public endpoints for arbitrary job claiming, action state updates or provider result writes.

Internal operations:

- `claimNextJob(workerId, leaseDuration)`
- `heartbeatJob(jobId, workerId, leaseGeneration)`
- `completePlanningJob(jobId, leaseGeneration, planResult)`
- `completeActionAttempt(jobId, leaseGeneration, providerOutcome)`
- `scheduleRetry(actionId, dueAt, reasonCode)`
- `markOutcomeUnknown(actionId, attemptId, safeSummary)`
- `scheduleReconciliation(actionId, dueAt)`
- `completeReconciliation(actionId, providerEvidence)`

Every mutation verifies job lease ownership/generation, valid action state, workspace scope and expected prior version.

## 7. HTTP status and error codes

| HTTP | Error code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query or header invalid |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired access token |
| 403 | `FORBIDDEN` | Role or permission insufficient |
| 404 | `NOT_FOUND` | Resource absent or outside caller's workspace (avoid disclosing cross-tenant existence) |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key with different request fingerprint |
| 409 | `INVALID_STATE_TRANSITION` | Command not valid for current state |
| 409 | `APPROVAL_EXPIRED` | Approval expired |
| 409 | `APPROVAL_MISMATCH` | Approved parameters/action version no longer match |
| 409 | `ALREADY_DECIDED` | Approval already decided |
| 409 | `ACTION_OUTCOME_UNKNOWN` | Execution cannot safely be repeated |
| 422 | `BUSINESS_RULE_REJECTED` | Deterministic policy/business rule denies request |
| 429 | `RATE_LIMITED` | Caller rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected safe generic error |
| 503 | `DEPENDENCY_UNAVAILABLE` | Required dependency temporarily unavailable |

All errors include a request ID. Do not leak SQL or provider internals.

## 8. Rate limits and payload limits

Initial proposed limits (tunable after observing the demo):

- JSON body maximum: 64 KB for workflow creation.
- Customer message maximum: 4,000 characters.
- List limit maximum: 100.
- Workflow creation: 10 requests/minute/user.
- Approval decisions: 30 requests/minute/user.
- Read endpoints: 120 requests/minute/user.

Return `429` with `Retry-After`. These are initial application safeguards, not a public SLA.

## 9. API security requirements

- Validate Supabase JWT server-side.
- Derive user identity from validated token, never request body.
- Check workspace membership and role on every route.
- Validate IDs and path/body schemas.
- Enforce CORS allowlist for the deployed dashboard origin.
- Use CSRF protections if cookie-based auth is used; Bearer-token APIs must still protect token storage and origin policy.
- Never expose service-role or LLM keys to browser.
- Use idempotency and transactional state transitions for commands.
- Redact secrets and customer-sensitive content from errors/logs.

## 10. Deferred endpoints

Not in MVP:

- Public agent tool execution endpoint.
- MCP server endpoint.
- Generic workflow builder.
- External payment webhooks.
- Billing and usage metering API.
- Organization invitation/role administration API.
- Arbitrary provider connection management.

These require separate contracts and security review before implementation.
