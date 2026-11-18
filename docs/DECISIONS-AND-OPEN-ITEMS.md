# ActionLedger — Decisions and Open Items

**Version:** 0.1

## Decisions made for the MVP

1. Build ActionLedger as an open-source engineering showcase, not a commercial SaaS launch.
2. Focus on reliable execution of AI-agent actions.
3. Use a synthetic customer-support refund workflow as the first demo.
4. Use a modular monolith with a separate persistent Node.js worker.
5. Use TypeScript, Fastify, Next.js, Supabase PostgreSQL, Zod, Vitest and Playwright.
6. Use a PostgreSQL-backed job table initially; do not add Redis or Kafka without evidence that they are needed.
7. Use mock agents and a simulated payment provider before connecting paid AI or financial services.
8. Keep deterministic policy enforcement separate from LLM reasoning.
9. Treat ambiguous external outcomes as unknown and reconcile before retry.
10. Keep real payment processing, arbitrary code execution and general workflow building out of the MVP.
11. Use Vercel for the dashboard, not as a persistent worker host.
12. Account for the developer's 4 GB RAM laptop: avoid a required local full Docker/Supabase/Ollama stack.
13. Keep all public demo data synthetic.

## Open items to decide during implementation

1. Exact Supabase Auth verification mechanism and API server integration.
2. Final database connection strategy and connection pooling for API/worker.
3. Exact migration execution approach and whether local Supabase CLI/Docker is feasible on the laptop.
4. Initial persistent hosting option for API and worker after measuring deployment requirements and reviewing current free tiers.
5. Whether the demo needs one or more workspace roles beyond owner/operator/viewer.
6. Exact deterministic refund policy conditions and demo fixtures.
7. Whether order update and customer notification are separate actions in the first vertical slice or a later workflow stage.
8. Which single real LLM provider to add after mock workflow acceptance tests pass.
9. Which MCP SDK/client combination to use in the later milestone.
10. Whether a public demo should allow anonymous read-only viewing or require a seeded demo login.

## Explicit assumptions

- The first release is single-workspace per account in the UI, although records retain workspace boundaries.
- One demo order uses one successful payment.
- The default refund approval threshold is USD 100.00; this is a configurable demo rule, not a real-world standard.
- The first provider simulator shares the PostgreSQL database but has separate `demo_` tables and distinct provider-side idempotency.
- A provider that cannot confirm an ambiguous outcome causes manual attention rather than an automatic retry.
- Free-tier services are development/demo conveniences, not an availability guarantee.

## Reconciliation notes

The API spec requires `PLAN_WORKFLOW` jobs and HTTP idempotency. The consolidated database schema includes `workflow_id` on `execution_jobs`, nullable `action_id` for planning jobs, and the `idempotency_records` table. These must be reflected in migrations.
