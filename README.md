# SPNpeet POS — Enterprise Offline-First Point of Sale & Inventory

A production-grade, offline-capable POS & Inventory platform built for
concurrent usage, zero-downtime and strict data consistency.

> Monorepo: **Next.js PWA** (offline-first register) + **Golang Transaction
> Engine** (atomic checkout with pessimistic locking) + **Supabase/PostgreSQL**
> (RLS, audit triggers).

```
┌──────────────────────────┐        ┌───────────────────────────┐        ┌──────────────────────┐
│  apps/web  (Next.js PWA)  │  HTTPS │  apps/api (Golang/Fiber)   │  pgx   │  PostgreSQL / Supabase│
│  • Workbox service worker │ ─────▶ │  • Clean Architecture      │ ─────▶ │  • RLS (deny-by-deflt) │
│  • IndexedDB sync queue   │  JWT   │  • SELECT … FOR UPDATE      │        │  • audit triggers      │
│  • ZXing WASM scanner     │        │  • idempotent checkout     │        │  • atomic checkout fn  │
└──────────────────────────┘        └───────────────────────────┘        └──────────────────────┘
```

## Repository layout

```
.
├── apps/
│   ├── web/                 Next.js App Router PWA (offline-first POS)
│   └── api/                 Golang transaction engine (Clean Architecture)
├── supabase/
│   └── migrations/          SQL: schema, audit triggers, RLS, checkout fn, seed
├── docker-compose.yml       Local prod-like stack (db + api + web)
├── turbo.json               Turborepo pipeline
└── .env.example             Configuration template
```

## Core guarantees

| Requirement | Where it lives | How |
|-------------|----------------|-----|
| **Pessimistic concurrency** | `apps/api/internal/repository/postgres/checkout_repo.go`, `supabase/migrations/0003_checkout_functions.sql` | `SELECT … FOR UPDATE` on inventory rows, acquired in deterministic product-id order (deadlock-free), under a bounded `lock_timeout`. |
| **Atomicity** | same | One DB transaction: validate → lock → deduct → ledger → order → commit. |
| **Idempotency** | checkout repo + `orders.client_uuid` unique | Device-generated `client_uuid`; replays return the existing order — offline retries never double-charge. |
| **Audit trails** | `supabase/migrations/0002_audit_logs.sql` | One generic trigger logs every INSERT/UPDATE/DELETE on `products`, `inventory`, `orders` into append-only `audit.*_audit_log` (old/new jsonb + actor id). |
| **RLS** | `supabase/migrations/0004_rls_policies.sql` | Deny-by-default; only `authenticated` staff read/write; audit tables locked to `service_role`. |
| **Offline-first** | `apps/web/src/lib/sync`, `next.config.mjs` | Persist-first IndexedDB sync queue + Workbox `NetworkFirst` catalog cache. |
| **Zero-latency scan** | `apps/web/src/components/pos/barcode-scanner.tsx` | ZXing rear-camera decode → local IndexedDB lookup (no network on the hot path). |

## Quick start (Docker)

```bash
cp .env.example .env          # adjust secrets
docker compose up --build
#   web → http://localhost:3000   (redirects to /pos)
#   api → http://localhost:8080   (/healthz, /readyz)
#   db  → localhost:5432          (migrations auto-applied on first boot)
```

The Postgres container auto-applies `supabase/migrations/*` in order. The
compat shim (`0000`) makes the same SQL run on both vanilla Postgres and
Supabase.

## Local development

```bash
pnpm install
pnpm dev                       # turbo: runs web + api dev together
# or individually:
pnpm --filter @spnpeet/web dev
pnpm --filter @spnpeet/api dev
go -C apps/api test ./...      # engine unit tests
```

## Deploying to Supabase

Apply `supabase/migrations/*.sql` (e.g. `supabase db push` or the SQL editor),
then point the Golang engine's `DATABASE_URL` at the Supabase **session**
connection (direct, not the transaction pooler — `FOR UPDATE` needs a session),
and set `SUPABASE_JWT_SECRET` so the engine verifies staff JWTs.

See `apps/api/README.md` and `apps/web/README.md` for component details.
