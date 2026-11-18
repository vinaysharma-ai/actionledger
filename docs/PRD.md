# ActionLedger — Product Requirements Document (PRD)

**Version:** 0.1  
**Status:** Baseline for MVP planning  
**Product category:** AI-agent execution and reliability infrastructure  
**Project type:** Open-source developer tool and engineering showcase

## 1. Product summary

ActionLedger is an execution-control layer between AI agents and external business systems. It accepts structured action proposals from agents, applies deterministic policies, requests human approval when required, executes authorized operations through registered adapters, and records evidence of the outcome.

**Positioning:** Reliable execution infrastructure for AI agents.

**Core principle:** Agents propose. Policies authorize. Runtime executes. Evidence verifies.

ActionLedger is not an agent builder, payment processor, general workflow builder or n8n replacement.

## 2. Problem statement

AI agents can decide to call tools that change business state: refund a payment, update an order, modify a CRM record or send a customer communication. A valid tool call is not the same as a reliable business operation.

Distributed systems produce ambiguous outcomes. An external provider may commit a refund while the response is lost. A worker may crash after the provider call. A retry can repeat an irreversible action. A workflow may partially complete. An agent may request an operation it is not authorized to perform or report success without evidence.

Developers need a control layer that makes these operations auditable, policy-controlled and recoverable.

## 3. Target users

### Primary: AI application developers

Developers integrating agents with payment, commerce, CRM, support and other business tools. They need stable action contracts, authorization, execution status, retry and reconciliation behaviour, and integration interfaces.

### Secondary: engineering and operations teams

People supervising business operations who need to inspect actions, approve high-impact operations, investigate failures and verify final outcomes.

## 4. Product goals

1. Provide a typed contract for an agent-proposed action.
2. Enforce authorization through deterministic software, not an LLM.
3. Support human approval bound to the exact action version and parameters.
4. Persist workflow, action and execution state in PostgreSQL.
5. Prevent duplicate logical actions through idempotency.
6. Recover safely from worker restarts and ambiguous provider outcomes.
7. Verify external state before reporting completion.
8. Provide an inspectable dashboard and reproducible technical demonstration.

## 5. Non-goals

The initial MVP will not:

- Process real customer payments or store card data.
- Provide a general-purpose visual agent builder.
- Replace n8n or existing durable workflow engines.
- Execute arbitrary code supplied by users or agents.
- Offer enterprise billing, subscription management or complex multi-tenant administration.
- Support dozens of production integrations.
- Guarantee exactly-once execution across arbitrary third-party APIs.

## 6. Initial use case

A synthetic customer asks for a refund for order `ORD-1042`.

1. The API stores the customer request and enqueues planning work.
2. The Planner proposes a structured sequence: retrieve order, check refund eligibility, request refund, update order, prepare notification.
3. The Reviewer checks for missing context and inconsistencies. Its output is advisory.
4. The deterministic policy engine decides which actions are allowed and which require approval.
5. An authorized human approves the exact action when required.
6. A persistent worker executes each eligible action through simulated providers.
7. If a provider response is lost, ActionLedger reconciles the operation before retrying.
8. The system verifies provider state and records the result.
9. The dashboard displays the workflow and audit timeline.

All customer, order and payment data is synthetic.

## 7. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Accept and validate a customer refund workflow request | Must |
| FR-02 | Persist workflow and planning job atomically | Must |
| FR-03 | Generate structured action proposals through a Planner interface | Must |
| FR-04 | Validate proposals against registered action schemas | Must |
| FR-05 | Record advisory Reviewer findings | Must |
| FR-06 | Evaluate action authorization through deterministic policies | Must |
| FR-07 | Support approval, rejection and expiration | Must |
| FR-08 | Bind approval to action version and parameter hash | Must |
| FR-09 | Persist actions, jobs and attempts | Must |
| FR-10 | Claim jobs safely across worker instances | Must |
| FR-11 | Prevent duplicate logical execution | Must |
| FR-12 | Simulate provider timeout after a committed refund | Must |
| FR-13 | Reconcile ambiguous provider outcomes | Must |
| FR-14 | Recover work after worker restart | Must |
| FR-15 | Maintain append-only audit events | Must |
| FR-16 | Provide workflow, action and approval APIs | Must |
| FR-17 | Provide a basic dashboard | Should |
| FR-18 | Support mock and real LLM provider adapters | Should; mock first |
| FR-19 | Provide a controlled MCP interface | Later milestone |

## 8. Non-functional requirements

- **Reliability:** persistent state, bounded retries, safe handling of uncertainty, validated state transitions.
- **Security:** least privilege, authenticated workspace access, no secrets in browser, no arbitrary code execution.
- **Observability:** stable IDs, structured logs, attempt history, safe error categories and audit events.
- **Maintainability:** strict TypeScript, modular domain logic, validated contracts and documented decisions.
- **Cost discipline:** develop with mocked agents and simulated providers; use free tiers where practical; no paid dependency is required for the first local milestone.
- **Demonstrability:** provide seeded demo data and repeatable failure scenarios.

## 9. Product behaviour and invariants

1. The LLM cannot authorize its own action.
2. An approval applies only to the exact action version and normalized parameter hash approved.
3. The same idempotency key and same normalized request returns the same logical resource.
4. Reusing a key with different parameters returns a conflict.
5. A timeout is not proof that an external operation failed.
6. A stale worker cannot overwrite a newer lease holder's result.
7. An action is `SUCCEEDED` only after the configured verification condition is met.
8. An uncertain provider outcome is reconciled or escalated; it is not blindly retried.
9. Successful child actions are not repeated merely because a later workflow step failed.
10. Audit history is append-only for ordinary application roles.

## 10. MVP acceptance criteria

The MVP is acceptable when automated, reproducible tests demonstrate:

- A refund request becomes a persisted workflow.
- Planning creates validated actions and policy decisions.
- An approval-required refund cannot execute before approval.
- An expired or parameter-mismatched approval is rejected.
- Duplicate request replay does not create another workflow or refund.
- A provider refund can commit while the simulated response is lost.
- Reconciliation detects the committed refund without creating another refund.
- Worker restart does not erase state or cause blind duplicate execution.
- A partial workflow resumes without repeating verified successful actions.
- Workspace boundaries prevent cross-tenant reads and writes.
- The dashboard shows the action timeline and actual verified state.

## 11. Product success measures

For the portfolio release, success is based on engineering evidence, not revenue or sign-ups:

- All critical acceptance tests pass in CI.
- The demo is reproducible from documented instructions.
- The failure-injection scenarios are visible and explainable.
- A developer can understand the API and integrate a mock agent.
- A reviewer can inspect architecture, database schema, security decisions and test results.
- The author can explain and modify the core code independently.

No reliability or performance metric may be published without measurement and a documented method.

## 12. Scope sequence

1. Core execution engine and simulated provider.
2. Idempotency, worker leasing, uncertainty and reconciliation.
3. Deterministic policies and human approval.
4. Mock Planner and Reviewer, then one real LLM adapter.
5. Operational dashboard.
6. MCP adapter, security hardening, deployment and public demo.
