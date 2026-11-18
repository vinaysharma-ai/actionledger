# ActionLedger

ActionLedger is an open-source engineering project for reliable execution of AI-agent actions. It uses a modular TypeScript monolith and a separate persistent worker to separate AI reasoning from deterministic authorization and provider execution.

The approved architecture and delivery plan are in:

- [System architecture](docs/SYSTEM-ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION-PLAN.md)
- [Decisions and open items](docs/DECISIONS-AND-OPEN-ITEMS.md)

## M0 scaffold status

The repository currently contains the M0 pnpm monorepo and TypeScript foundation:

- `apps/web`, `apps/api`, and `apps/worker`
- Shared package workspaces for contracts, domain, database, policies, execution, providers, and agents
- Supabase migration and GitHub Actions directories
- Strict base TypeScript configuration
- Biome formatting and lint configuration
- CI dependency installation and check commands

No application framework, business logic, database migrations, external SDK, queue, cache, or container service is configured yet. M0 stops before M1 and the later implementation milestones.

## Requirements

- Node.js >=24 and <27
- pnpm 11.15.1

The repository pins the package manager in `package.json`.

## Installation

From PowerShell:

```powershell
corepack enable
corepack prepare pnpm@11.15.1 --activate
pnpm install
```

For a clean clone, use the committed lockfile:

```powershell
pnpm install --frozen-lockfile
```

## Development

Run the repository checks:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check
```

Format source files:

```powershell
pnpm format
```

Copy `.env.example` to `.env` when environment variables are needed in later milestones. Do not add credentials or secrets to this repository.
